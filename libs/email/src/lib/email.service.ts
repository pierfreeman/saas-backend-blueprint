import { Injectable, Inject, Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ActivityLogService } from '@libs/activity-log';
import { SendEmailDto } from './dto/send-email.dto';
import {
  EmailProvider,
  EMAIL_PROVIDER_TOKEN,
} from './providers/email-provider.interface';
import { TemplateService } from './templates/template.service';
import type {
  EmailTemplateName,
  EmailTemplateData,
} from './types/email-template.type';

export interface SendTransactionalEmailInput {
  /** Recipient email address. */
  to: string;
  /** Email subject line. */
  subject: string;
  /** Template name (`.hbs` file without extension). */
  template: EmailTemplateName | string;
  /** Template data injected into the Handlebars template. */
  templateData: EmailTemplateData | Record<string, unknown>;
  /** Optional plain-text fallback body (auto-derived from subject if omitted). */
  text?: string;
  /** Organisation ID for audit logging. */
  orgId?: string;
  /** Recipient internal user ID for audit logging. */
  recipientUserId?: string;
}

/**
 * EmailService
 *
 * Orchestrates transactional email sending:
 *   1. Renders the Handlebars template.
 *   2. Validates the outgoing DTO.
 *   3. Delegates delivery to the injected EmailProvider (SendGrid, etc.).
 *   4. Emits an audit log event (EMAIL_SENT or EMAIL_FAILED).
 *
 * Email failures are caught and logged — they never propagate to callers.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER_TOKEN)
    private readonly emailProvider: EmailProvider,
    private readonly templateService: TemplateService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Renders a template and sends the email.
   * Swallows provider errors and emits an audit log on both success and failure.
   */
  async sendTransactionalEmail(
    input: SendTransactionalEmailInput,
  ): Promise<void> {
    let html: string;

    try {
      html = this.templateService.render(input.template, input.templateData);
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `Template render failed for "${input.template}": ${msg}`,
      );
      this.auditFailure(input, `Template render error: ${msg}`);
      return;
    }

    const dto = plainToInstance(SendEmailDto, {
      to: input.to,
      subject: input.subject,
      html,
      text: input.text,
      template: input.template,
      orgId: input.orgId,
      recipientUserId: input.recipientUserId,
    });

    const errors = await validate(dto);
    if (errors.length > 0) {
      const msg = errors
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .join('; ');
      this.logger.error(`Email DTO validation failed: ${msg}`);
      this.auditFailure(input, `Validation error: ${msg}`);
      return;
    }

    try {
      await this.emailProvider.sendEmail({
        to: dto.to,
        subject: dto.subject,
        html: dto.html,
        text: dto.text,
      });

      this.logger.log(
        `[EMAIL_SENT] to="${input.to}" template="${input.template}" orgId="${input.orgId ?? 'n/a'}"`,
      );

      if (input.orgId) {
        this.activityLog.logActivity({
          orgId: input.orgId,
          actorId: null,
          action: 'email.sent',
          entityType: 'Email',
          metadata: {
            recipient: input.to,
            template: input.template,
            status: 'sent',
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `[EMAIL_FAILED] to="${input.to}" template="${input.template}": ${msg}`,
      );
      this.auditFailure(input, msg);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private auditFailure(
    input: SendTransactionalEmailInput,
    reason: string,
  ): void {
    if (!input.orgId) return;
    this.activityLog.logActivity({
      orgId: input.orgId,
      actorId: null,
      action: 'email.failed',
      entityType: 'Email',
      metadata: {
        recipient: input.to,
        template: input.template,
        status: 'failed',
        reason,
        timestamp: new Date().toISOString(),
      },
    });
  }
}
