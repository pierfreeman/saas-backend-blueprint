import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrgDeletionService } from './org-deletion.service';
import { DeletionTrigger } from '../../interfaces/org-deletion-event.interface';
import { OrgDeletionRepository } from '../../infrastructure/repositories/org-deletion.repository';

/**
 * Scheduled task service for checking organizations eligible for deletion.
 *
 * Runs periodically to find organizations that:
 * - Have status SUSPENDED
 * - Have expired subscriptions
 * - Have passed their retention period
 *
 * When found, triggers deletion workflow by calling OrgDeletionService.
 */
@Injectable()
export class OrgDeletionSchedulerService {
  private readonly logger = new Logger(OrgDeletionSchedulerService.name);

  constructor(
    private readonly repo: OrgDeletionRepository,
    private readonly deletionService: OrgDeletionService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Scheduled task that runs daily at 3 AM (default) to check for organizations
   * eligible for deletion.
   *
   * Cron expression can be customized via ORG_DELETION_CHECK_CRON env var.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'check-expired-organizations',
  })
  async checkExpiredOrganizations(): Promise<void> {
    this.logger.log('Starting scheduled check for expired organizations');

    try {
      const now = new Date();

      // Find organizations that are suspended and have passed their deletion scheduled date
      const orgsToDelete = await this.repo.findOrgsEligibleForDeletion(now);

      this.logger.log(
        `Found ${orgsToDelete.length} organizations eligible for deletion`,
      );

      // Trigger deletion for each organization
      for (const org of orgsToDelete) {
        try {
          this.logger.log(
            `Triggering deletion for suspended organization ${org.id}`,
          );

          // Use undefined for automatic deletions (system-triggered)
          await this.deletionService.requestDeletion(
            org.id,
            DeletionTrigger.SUBSCRIPTION_EXPIRY,
          );

          this.logger.log(
            `Successfully triggered deletion for organization ${org.id}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to trigger deletion for organization ${org.id}`,
            error instanceof Error ? error.stack : String(error),
          );
          // Continue with next organization even if one fails
        }
      }

      this.logger.log('Completed scheduled check for expired organizations');
    } catch (error) {
      this.logger.error(
        'Failed to check for expired organizations',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
