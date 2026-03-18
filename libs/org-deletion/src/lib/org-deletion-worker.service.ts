import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { StorageService } from '@libs/storage';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationStatus } from '@prisma/client';
import Stripe from 'stripe';
import {
  DeletionTrigger,
  ORG_DELETION_EVENT_TYPES,
} from './constants/org-deletion-event.constants';

/**
 * Worker service responsible for executing organization deletion.
 * Performs all cleanup operations:
 * - Storage files deletion
 * - Database records deletion
 * - Redis cache cleanup
 * - External resources cleanup (Stripe)
 *
 * This service is idempotent and safe to retry.
 */
@Injectable()
export class OrgDeletionWorkerService {
  private readonly logger = new Logger(OrgDeletionWorkerService.name);
  private readonly stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly eventBus: EventBusService,
    private readonly legalAudit: LegalAuditService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    // Initialize Stripe if configured
    const stripeKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (stripeKey && !stripeKey.startsWith('sk_test_...')) {
      this.stripe = new Stripe(stripeKey, {
        apiVersion: '2026-02-25.clover',
      });
    }
  }

  /**
   * Execute organization deletion.
   * This is the main entry point called by the worker.
   *
   * @param orgId - Organization ID to delete
   * @param trigger - Deletion trigger source
   * @param orgName - Organization name (for logging/audit)
   * @param requestedAt - When deletion was requested
   */
  async executeDeletion(
    orgId: string,
    trigger: DeletionTrigger,
    orgName: string,
    requestedAt: Date,
  ): Promise<void> {
    this.logger.log(`Starting deletion for organization ${orgId} (${orgName})`);

    const startedAt = new Date();

    // Emit deletion started event
    await this.eventBus.publish({
      eventType: ORG_DELETION_EVENT_TYPES.DELETION_STARTED,
      payload: {
        orgId,
        trigger,
        startedAt,
      } as unknown as Record<string, unknown>,
      tenantId: orgId,
      timestamp: new Date(),
    });

    try {
      // Check if organization exists and is not already deleted
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          id: true,
          name: true,
          status: true,
          stripeCustomerId: true,
          subscriptionId: true,
        },
      });

      if (!org) {
        this.logger.warn(
          `Organization ${orgId} not found — already deleted or never existed`,
        );
        return; // Idempotent: treat as success
      }

      if (org.status === OrganizationStatus.DELETED) {
        this.logger.warn(
          `Organization ${orgId} already marked as DELETED — skipping`,
        );
        return; // Idempotent: already processed
      }

      // Step 1: Delete storage files
      await this.deleteStorageFiles(orgId);

      // Step 2: Revoke external resources (Stripe)
      if (org.stripeCustomerId || org.subscriptionId) {
        await this.revokeExternalResources(
          org.stripeCustomerId,
          org.subscriptionId,
        );
      }

      // Step 3: Clear Redis cache
      await this.clearRedisCache(orgId);

      // Step 4: Delete database records
      await this.deleteDatabaseRecords(orgId);

      // Step 5: Mark organization as DELETED
      await this.markOrganizationDeleted(orgId);

      const completedAt = new Date();

      this.logger.log(
        `Organization ${orgId} (${orgName}) deleted successfully`,
      );

      // Emit deletion completed event
      await this.eventBus.publish({
        eventType: ORG_DELETION_EVENT_TYPES.DELETION_COMPLETED,
        payload: {
          orgId,
          trigger,
          orgName,
          requestedAt,
          completedAt,
        } as unknown as Record<string, unknown>,
        tenantId: orgId,
        timestamp: new Date(),
      });

      // Record legal audit event (permanent)
      this.legalAudit.recordEvent({
        eventType: 'organization.deleted',
        orgId,
        triggerType:
          trigger === DeletionTrigger.USER_REQUEST ? 'user' : 'system',
        metadata: {
          organizationId: orgId,
          organizationName: orgName,
          trigger,
          requestedAt: requestedAt.toISOString(),
          completedAt: completedAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to delete organization ${orgId}: ${message}`,
        error,
      );

      // Emit deletion failed event
      await this.eventBus.publish({
        eventType: ORG_DELETION_EVENT_TYPES.DELETION_FAILED,
        payload: {
          orgId,
          trigger,
          error: message,
          failedAt: new Date(),
        } as unknown as Record<string, unknown>,
        tenantId: orgId,
        timestamp: new Date(),
      });

      // Record failure in legal audit
      this.legalAudit.recordEvent({
        eventType: 'organization.deletion.failed',
        orgId,
        triggerType:
          trigger === DeletionTrigger.USER_REQUEST ? 'user' : 'system',
        metadata: {
          organizationId: orgId,
          organizationName: orgName,
          trigger,
          error: message,
          failedAt: new Date().toISOString(),
        },
      });
    }
  }

  /**
   * Delete all storage files for the organization.
   */
  private async deleteStorageFiles(orgId: string): Promise<void> {
    this.logger.log(`Deleting storage files for organization ${orgId}`);
    await this.storage.deleteFolder(`org/${orgId}`);
    this.logger.log(
      `Storage files deletion completed for organization ${orgId}`,
    );
  }

  /**
   * Revoke external resources (Stripe subscriptions and customers).
   */
  private async revokeExternalResources(
    stripeCustomerId?: string | null,
    subscriptionId?: string | null,
  ): Promise<void> {
    if (!this.stripe) {
      this.logger.log('Stripe not configured - skipping external cleanup');
      return;
    }

    try {
      // Cancel subscription if exists
      if (subscriptionId) {
        this.logger.log(`Canceling Stripe subscription ${subscriptionId}`);
        try {
          await this.stripe.subscriptions.cancel(subscriptionId);
        } catch (error) {
          // Subscription might already be canceled
          this.logger.warn(
            `Failed to cancel subscription ${subscriptionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Delete customer if exists
      if (stripeCustomerId) {
        this.logger.log(`Deleting Stripe customer ${stripeCustomerId}`);
        try {
          await this.stripe.customers.del(stripeCustomerId);
        } catch (error) {
          // Customer might already be deleted
          this.logger.warn(
            `Failed to delete customer ${stripeCustomerId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Error during external resources cleanup', error);
      // Don't throw - continue with other cleanup steps
    }
  }

  /**
   * Clear all Redis cached data for the organization.
   */
  private async clearRedisCache(orgId: string): Promise<void> {
    this.logger.log(`Clearing Redis cache for organization ${orgId}`);
    await this.cache.deleteByPattern(`tenant:${orgId}:*`);
    this.logger.log(`Redis cache cleared for organization ${orgId}`);
  }

  /**
   * Delete all database records for the organization.
   * Respects cascade delete relationships defined in Prisma schema.
   */
  private async deleteDatabaseRecords(orgId: string): Promise<void> {
    this.logger.log(`Deleting database records for organization ${orgId}`);

    try {
      // Delete in transaction to ensure atomicity
      await this.prisma.$transaction(async (tx) => {
        await tx.file.deleteMany({ where: { orgId } });
        await tx.notification.deleteMany({ where: { orgId } });
        await tx.orgExport.deleteMany({ where: { orgId } });
        await tx.job.deleteMany({ where: { orgId } });
        await tx.activityLog.deleteMany({ where: { orgId } });
        await tx.membership.deleteMany({ where: { orgId } });
        // Note: organization row is updated (not deleted) in markOrganizationDeleted
      });

      this.logger.log(`Database records deleted for organization ${orgId}`);
    } catch (error) {
      this.logger.error(
        `Error during database cleanup for organization ${orgId}`,
        error,
      );
      throw error; // This is critical - re-throw
    }
  }

  /**
   * Mark organization as DELETED and set completion timestamp.
   */
  private async markOrganizationDeleted(orgId: string): Promise<void> {
    this.logger.log(`Marking organization ${orgId} as DELETED`);

    try {
      await this.prisma.organization.update({
        where: { id: orgId },
        data: {
          status: OrganizationStatus.DELETED,
          deletionCompletedAt: new Date(),
        },
      });

      this.logger.log(`Organization ${orgId} marked as DELETED`);
    } catch (error) {
      this.logger.error(
        `Error marking organization ${orgId} as DELETED`,
        error,
      );
      throw error; // This is critical - re-throw
    }
  }
}
