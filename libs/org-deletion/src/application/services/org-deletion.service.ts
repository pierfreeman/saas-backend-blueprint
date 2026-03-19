import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { ActivityLogService } from '@libs/activity-log';
import {
  ORG_DELETION_EVENT_TYPES,
  DeletionTrigger,
} from '../../constants/org-deletion-event.constants';
import { OrgDeletionRequestedEventPayload } from '../../interfaces/org-deletion-event.interface';
import { OrgDeletionRepository } from '../../infrastructure/repositories/org-deletion.repository';

/**
 * Service responsible for orchestrating organization deletion requests.
 * Handles deletion scheduling, retention period calculation, and event emission.
 *
 * This service does NOT perform the actual data cleanup - that is handled
 * by the deletion worker in response to deletion events.
 */
@Injectable()
export class OrgDeletionService {
  private readonly logger = new Logger(OrgDeletionService.name);
  private readonly defaultRetentionDays: number;

  constructor(
    private readonly repo: OrgDeletionRepository,
    private readonly eventBus: EventBusService,
    private readonly legalAudit: LegalAuditService,
    private readonly activityLog: ActivityLogService,
    private readonly config: ConfigService,
  ) {
    this.defaultRetentionDays = this.config.get<number>(
      'ORG_DELETION_RETENTION_DAYS',
      30,
    );
  }

  /**
   * Request deletion of an organization.
   * Sets status to PENDING_DELETION, schedules deletion, and emits event.
   *
   * @param orgId - Organization ID to delete
   * @param trigger - Deletion trigger (user request or subscription expiry)
   * @param userId - User ID who requested deletion (optional for system triggers)
   * @throws NotFoundException if organization not found
   * @throws BadRequestException if organization already being deleted
   */
  async requestDeletion(
    orgId: string,
    trigger: DeletionTrigger,
    userId?: string,
  ): Promise<void> {
    this.logger.log(
      `Deletion requested for organization ${orgId} (trigger: ${trigger})`,
    );

    // Load organization
    const org = await this.repo.findOrgById(orgId);

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    // Check if already in deletion process
    if (org.status === 'PENDING_DELETION' || org.status === 'DELETED') {
      throw new BadRequestException(
        `Organization ${orgId} is already being deleted or has been deleted`,
      );
    }

    // Calculate retention period
    const retentionDays = org.retentionPeriodDays ?? this.defaultRetentionDays;
    const now = new Date();
    const scheduledAt = new Date(
      now.getTime() + retentionDays * 24 * 60 * 60 * 1000,
    );

    // Update organization status and deletion timestamps
    await this.repo.markPendingDeletion(orgId, {
      deletionRequestedAt: now,
      deletionScheduledAt: scheduledAt,
    });

    this.logger.log(
      `Organization ${orgId} marked for deletion. Scheduled for ${scheduledAt.toISOString()}`,
    );

    // Log to activity log (will be cascade-deleted with org)
    this.activityLog.logActivity({
      orgId,
      actorId: userId ?? null,
      action: 'organization.deletion.requested',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        trigger,
        requestedAt: now.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        retentionDays,
      },
    });

    // Record legal audit event (permanent, survives deletion)
    this.legalAudit.recordEvent({
      eventType: 'organization.deletion.requested',
      orgId,
      triggerType: trigger === DeletionTrigger.USER_REQUEST ? 'user' : 'system',
      metadata: {
        organizationId: orgId,
        organizationName: org.name,
        trigger,
        userId: userId ?? null,
        requestedAt: now.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        retentionDays,
      },
    });

    // Emit event to trigger background deletion worker
    const eventPayload: OrgDeletionRequestedEventPayload = {
      orgId,
      trigger,
      userId,
      orgName: org.name,
      requestedAt: now,
      scheduledAt,
    } as OrgDeletionRequestedEventPayload;

    await this.eventBus.publish({
      eventType: ORG_DELETION_EVENT_TYPES.DELETION_REQUESTED,
      payload: eventPayload as Record<string, unknown>,
      tenantId: orgId,
      userId,
      timestamp: new Date(),
    });

    this.logger.log(`Deletion event emitted for organization ${orgId}`);
  }

  /**
   * Find organizations eligible for deletion.
   * Returns organizations that are SUSPENDED, have expired subscriptions,
   * and whose retention period has elapsed.
   *
   * This is used by the scheduled job to automatically trigger deletions.
   */
  async findOrgsEligibleForDeletion(): Promise<
    Array<{ id: string; name: string }>
  > {
    const now = new Date();

    // Find organizations that are:
    // 1. SUSPENDED status
    // 2. Have a subscription period end date in the past
    // 3. Retention period has elapsed since subscription ended
    const eligibleOrgs =
      await this.repo.findSuspendedOrgsWithExpiredSubscriptions(now);

    // Filter by retention period
    const eligible = eligibleOrgs.filter((org) => {
      const retentionDays =
        org.retentionPeriodDays ?? this.defaultRetentionDays;
      const retentionEnd = new Date(
        org.subscriptionPeriodEnd!.getTime() +
          retentionDays * 24 * 60 * 60 * 1000,
      );
      return now >= retentionEnd;
    });

    this.logger.log(
      `Found ${eligible.length} organizations eligible for deletion`,
    );

    return eligible.map((org) => ({ id: org.id, name: org.name }));
  }
}
