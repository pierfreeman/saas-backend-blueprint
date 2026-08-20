import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { CacheService } from '@libs/redis';
import { StorageService } from '@libs/storage';
import { StripeService } from '@libs/billing';
import { EmailService } from '@libs/email';
import { Injectable, Logger } from '@nestjs/common';
import { DeletionTrigger } from '../../interfaces/org-deletion-event.interface';
import { OrgDeletionRepository } from '../../infrastructure/repositories/org-deletion.repository';
import { runWithTenant } from '@libs/prisma-business';

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

  constructor(
    private readonly repo: OrgDeletionRepository,
    private readonly eventBus: EventBusService,
    private readonly legalAudit: LegalAuditService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly stripeService: StripeService,
    private readonly email: EmailService,
  ) {}

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
    requestedByUserId?: string,
  ): Promise<void> {
    // Establishes its own tenant context (rather than relying solely on the
    // caller having done so) since this is the entry point for a
    // self-contained unit of work, and orgId is already known here — same
    // reasoning as the worker's own runWithTenant wrapping in
    // apps/worker-a/src/worker.controller.ts. Nested runWithTenant calls
    // just override for their own scope, so this is harmless when the
    // caller already wrapped it.
    return runWithTenant(orgId, () =>
      this.executeDeletionImpl(
        orgId,
        trigger,
        orgName,
        requestedAt,
        requestedByUserId,
      ),
    );
  }

  private async executeDeletionImpl(
    orgId: string,
    trigger: DeletionTrigger,
    orgName: string,
    requestedAt: Date,
    requestedByUserId?: string,
  ): Promise<void> {
    this.logger.log(`Starting deletion for organization ${orgId} (${orgName})`);

    const startedAt = new Date();

    // Emit deletion started event
    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.ORG_DELETION_STARTED,
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
      const org = await this.repo.findOrgById(orgId);

      if (!org) {
        this.logger.warn(
          `Organization ${orgId} not found — already deleted or never existed`,
        );
        return; // Idempotent: treat as success
      }

      if (org.status === 'DELETED') {
        this.logger.warn(
          `Organization ${orgId} already marked as DELETED — skipping`,
        );
        return; // Idempotent: already processed
      }

      // Send deletion confirmation email BEFORE any data is removed
      if (requestedByUserId) {
        await this.sendDeletionConfirmationEmail(
          requestedByUserId,
          orgName,
          orgId,
        );
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
        eventType: DOMAIN_EVENTS.ORG_DELETION_COMPLETED,
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
          requestedAt: new Date(requestedAt).toISOString(),
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
        eventType: DOMAIN_EVENTS.ORG_DELETION_FAILED,
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
   * Look up the requesting user and send a deletion confirmation email.
   * Sent before any data is deleted, so user records are still available.
   * Failures are logged but do not abort the deletion workflow.
   */
  private async sendDeletionConfirmationEmail(
    auth0Id: string,
    orgName: string,
    orgId: string,
  ): Promise<void> {
    try {
      const user = await this.repo.findUserByAuth0Id(auth0Id);

      if (!user) {
        this.logger.warn(
          `Cannot send deletion email — user not found for auth0Id: ${auth0Id}`,
        );
        return;
      }

      await this.email.sendTransactionalEmail({
        templateName: 'org-deletion-confirmation',
        recipient: user.email,
        subject: `Your organisation "${orgName}" is being deleted`,
        data: {
          userName: user.email.split('@')[0],
          organizationName: orgName,
          deletedAt: new Date().toISOString(),
        },
        orgId,
        userId: auth0Id,
      });

      this.logger.log(`Deletion confirmation email sent to ${user.email}`);
    } catch (err) {
      this.logger.error(
        `Failed to send deletion confirmation email: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
      // Do not rethrow — email failure must not abort deletion
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
    if (subscriptionId) {
      this.logger.log(`Canceling Stripe subscription ${subscriptionId}`);
      await this.stripeService.terminateSubscription(subscriptionId);
    }

    if (stripeCustomerId) {
      this.logger.log(`Deleting Stripe customer ${stripeCustomerId}`);
      await this.stripeService.deleteCustomer(stripeCustomerId);
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
    await this.repo.deleteDatabaseRecords(orgId);
    this.logger.log(`Database records deleted for organization ${orgId}`);
  }

  /**
   * Mark organization as DELETED and set completion timestamp.
   */
  private async markOrganizationDeleted(orgId: string): Promise<void> {
    this.logger.log(`Marking organization ${orgId} as DELETED`);
    await this.repo.markDeleted(orgId);
    this.logger.log(`Organization ${orgId} marked as DELETED`);
  }
}
