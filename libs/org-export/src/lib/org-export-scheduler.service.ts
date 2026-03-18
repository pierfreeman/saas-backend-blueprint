import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ExportStatus } from '@prisma/client';

/**
 * Scheduled service for managing export expiration.
 * Runs daily to mark expired exports and optionally clean up files.
 */
@Injectable()
export class OrgExportSchedulerService {
  private readonly logger = new Logger(OrgExportSchedulerService.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Mark exports as EXPIRED when their signed URLs have expired.
   * Runs daily at 3:00 AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async markExpiredExports(): Promise<void> {
    this.logger.log('Running scheduled export expiration check');

    const now = new Date();

    try {
      // Find exports that are COMPLETED but have expired URLs
      const expiredExports = await this.prisma.orgExport.findMany({
        where: {
          status: ExportStatus.COMPLETED,
          expiresAt: {
            not: null,
            lt: now,
          },
        },
        select: {
          id: true,
          orgId: true,
          expiresAt: true,
        },
      });

      if (expiredExports.length === 0) {
        this.logger.log('No expired exports found');
        return;
      }

      this.logger.log(`Found ${expiredExports.length} expired exports`);

      // Mark exports as EXPIRED
      const result = await this.prisma.orgExport.updateMany({
        where: {
          id: {
            in: expiredExports.map((e) => e.id),
          },
        },
        data: {
          status: ExportStatus.EXPIRED,
        },
      });

      this.logger.log(`Marked ${result.count} exports as EXPIRED`);

      // TODO: Optionally delete export files from storage
      // This would require iterating through expiredExports and calling
      // storage.deleteFile() for each one
      // For now, files remain in storage but are inaccessible via expired URLs
    } catch (error) {
      this.logger.error(
        'Error during export expiration check',
        error instanceof Error ? error.stack : error,
      );
      // Don't throw - this is a scheduled job, failures should be logged but not propagated
    }
  }
}
