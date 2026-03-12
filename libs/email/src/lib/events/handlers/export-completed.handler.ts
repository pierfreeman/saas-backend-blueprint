import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LocalTransport } from '@libs/events';
import { DOMAIN_EVENTS } from '@libs/events';
import { EmailService } from '../../email.service';
import type { DomainEvent } from '@libs/events';
import type { ExportReadyData } from '../../types/email-template.type';

export interface ExportCompletedPayload {
  recipientEmail: string;
  recipientName?: string;
  orgId: string;
  exportName: string;
  downloadUrl: string;
  expiresInHours?: number;
}

/**
 * ExportCompletedEmailHandler
 *
 * Listens for `export.completed` domain events and notifies the user
 * that their export file is ready for download.
 *
 * Event flow:
 *   ExportCompletedEvent (export.completed)
 *     → ExportCompletedEmailHandler
 *     → EmailService.sendTransactionalEmail
 *     → SendGridProvider
 */
@Injectable()
export class ExportCompletedEmailHandler implements OnModuleInit {
  private readonly logger = new Logger(ExportCompletedEmailHandler.name);

  constructor(
    private readonly localTransport: LocalTransport,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit(): void {
    this.localTransport.on(
      DOMAIN_EVENTS.EXPORT_COMPLETED,
      (event: DomainEvent) => {
        void this.handle(event);
      },
    );
    this.logger.log(`Subscribed to "${DOMAIN_EVENTS.EXPORT_COMPLETED}" events.`);
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as unknown as ExportCompletedPayload;

    if (!payload.recipientEmail || !payload.orgId) {
      this.logger.warn(
        `ExportCompletedEmailHandler: missing required fields in payload. Skipping.`,
      );
      return;
    }

    const templateData: ExportReadyData = {
      exportName: payload.exportName ?? 'Your export',
      downloadUrl: payload.downloadUrl,
      recipientName: payload.recipientName,
      expiresInHours: payload.expiresInHours,
    };

    await this.emailService.sendTransactionalEmail({
      to: payload.recipientEmail,
      subject: `Your export "${templateData.exportName}" is ready`,
      template: 'export-ready',
      templateData,
      orgId: payload.orgId,
    });
  }
}
