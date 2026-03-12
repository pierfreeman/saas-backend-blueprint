import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@libs/events';
import { EmailService } from '../../email.service';

/**
 * Payload for ExportCompletedEvent
 */
export interface ExportCompletedPayload {
  [key: string]: unknown;
  userName: string;
  userEmail: string;
  userId: string;
  organizationId: string;
  exportType: string;
  fileSize: string;
  recordCount: number;
  completedAt: Date;
  downloadUrl: string;
  downloadExpirationDays: number;
}

/**
 * ExportCompletedEmailHandler
 *
 * Listens for EXPORT_COMPLETED events and sends download notification emails.
 */
@Injectable()
export class ExportCompletedEmailHandler {
  private readonly logger = new Logger(ExportCompletedEmailHandler.name);

  constructor(private readonly emailService: EmailService) {}

  /**
   * Handle EXPORT_COMPLETED event
   */
  async handle(event: DomainEvent<ExportCompletedPayload>): Promise<void> {
    try {
      const { payload, tenantId } = event;

      this.logger.log(
        `Processing EXPORT_COMPLETED event for ${payload.userEmail}`,
      );

      // Send export ready email
      await this.emailService.sendTransactionalEmail({
        templateName: 'export-ready',
        recipient: payload.userEmail,
        subject: `Your ${payload.exportType} export is ready`,
        data: {
          userName: payload.userName,
          exportType: payload.exportType,
          fileSize: payload.fileSize,
          recordCount: payload.recordCount,
          completedAt: payload.completedAt,
          downloadUrl: payload.downloadUrl,
          downloadExpirationDays: payload.downloadExpirationDays,
        },
        orgId: payload.organizationId || tenantId,
        userId: payload.userId,
      });

      this.logger.log(
        `Export completion email initiated for ${payload.userEmail}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle EXPORT_COMPLETED event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Don't rethrow — email failures should not abort event processing
    }
  }
}
