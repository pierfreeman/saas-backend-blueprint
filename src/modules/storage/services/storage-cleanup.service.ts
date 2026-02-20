import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UploadSessionService } from '../services/upload-session.service';
import { MultipartUploadService } from '../services/multipart-upload.service';
import { StorageQuotaService } from '../services/storage-quota.service';
import { AuditService } from '../../audit/audit.service';

/**
 * Storage Cleanup Service
 *
 * Handles periodic cleanup tasks:
 * - Expire old upload sessions
 * - Clean up orphaned multipart uploads
 * - Delete old session records
 */
@Injectable()
export class StorageCleanupService implements OnModuleInit {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly uploadSessionService: UploadSessionService,
    private readonly multipartUploadService: MultipartUploadService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit() {
    this.logger.log('Storage Cleanup Service initialized');
  }

  /**
   * Mark expired upload sessions
   * Runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async markExpiredSessions() {
    this.logger.log('Running expired session cleanup job');

    try {
      const count = await this.uploadSessionService.markExpiredSessions();
      this.logger.log(`Marked ${count} expired upload sessions`);

      // Audit log
      await this.auditService.logEvent('STORAGE_CLEANUP_EXPIRED_SESSIONS', null, null, {
        count,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to mark expired sessions: ${error}`);
    }
  }

  /**
   * Delete old completed/aborted sessions
   * Runs daily at 2 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async deleteOldSessions() {
    this.logger.log('Running old session deletion job');

    try {
      const daysOld = 7; // Delete sessions older than 7 days
      const count = await this.uploadSessionService.deleteOldSessions(daysOld);
      this.logger.log(`Deleted ${count} old upload sessions`);

      // Audit log
      await this.auditService.logEvent('STORAGE_CLEANUP_OLD_SESSIONS', null, null, {
        count,
        daysOld,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to delete old sessions: ${error}`);
    }
  }

  /**
   * Cleanup expired upload sessions with provider
   * Runs every 6 hours
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async cleanupExpiredUploads() {
    this.logger.log('Running expired upload cleanup job with provider');

    try {
      const expiredSessions = await this.uploadSessionService.findExpiredSessions(50);

      let abortedCount = 0;
      for (const session of expiredSessions) {
        try {
          // Abort multipart upload with provider
          const storageKey = `${session.orgId}/${Date.now()}-${session.fileName}`;
          const bucketOrContainer = process.env.AWS_S3_BUCKET || 'default-bucket';

          await this.multipartUploadService.abortMultipartUpload(
            session.id,
            bucketOrContainer,
            storageKey,
          );

          abortedCount++;
        } catch (error) {
          this.logger.warn(`Failed to abort expired session ${session.id}: ${error}`);
        }
      }

      this.logger.log(`Aborted ${abortedCount} expired uploads with provider`);

      // Audit log
      await this.auditService.logEvent('STORAGE_CLEANUP_EXPIRED_UPLOADS', null, null, {
        abortedCount,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(`Failed to cleanup expired uploads: ${error}`);
    }
  }
}
