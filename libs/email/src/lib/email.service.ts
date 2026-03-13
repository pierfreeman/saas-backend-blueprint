import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import {
  EmailProvider,
  EMAIL_PROVIDER,
} from './providers/email-provider.interface';
import { TemplateRendererService } from './templates/template-renderer.service';
import {
  EmailTemplateName,
  EmailTemplateData,
} from './types/email-template.type';
import { SendEmailDto } from './dto/send-email.dto';

/**
 * Email Service
 *
 * Main application service for sending transactional emails.
 * Orchestrates template rendering and email provider invocation.
 * Implements fire-and-forget pattern with audit logging.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER)
    private readonly emailProvider: EmailProvider,
    private readonly templateRenderer: TemplateRendererService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  /**
   * Send a transactional email using a template
   *
   * @param templateName Template to use
   * @param recipient Recipient email address
   * @param subject Email subject
   * @param data Template data
   * @param orgId Organization ID (for audit logging)
   * @param userId User ID (for audit logging)
   */
  async sendTransactionalEmail(params: {
    templateName: EmailTemplateName;
    recipient: string;
    subject: string;
    data: EmailTemplateData;
    orgId?: string;
    userId?: string;
  }): Promise<void> {
    const { templateName, recipient, subject, data, orgId, userId } = params;

    try {
      // Validate input
      if (!recipient || !this.isValidEmail(recipient)) {
        throw new Error(`Invalid recipient email: ${recipient}`);
      }

      if (!subject || subject.trim().length === 0) {
        throw new Error('Email subject is required');
      }

      // Render template
      const html = await this.templateRenderer.render(templateName, data);

      // Create email payload
      const emailDto: SendEmailDto = {
        to: recipient,
        subject,
        html,
      };

      // Send email (fire-and-forget)
      this.sendEmailAsync(emailDto, templateName, orgId, userId);
    } catch (error) {
      this.logger.error(
        `Failed to initiate email send: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Log failure to audit
      this.logEmailFailure(templateName, recipient, orgId, userId, error);
    }
  }

  /**
   * Send email asynchronously (fire-and-forget)
   * Failures are logged but don't propagate to caller
   */
  private async sendEmailAsync(
    emailDto: SendEmailDto,
    templateName: string,
    orgId?: string,
    userId?: string,
  ): Promise<void> {
    try {
      await this.emailProvider.sendEmail(emailDto);

      this.logger.log(
        `Email sent successfully: template=${templateName}, to=${emailDto.to}`,
      );

      // Log success to audit
      this.logEmailSuccess(templateName, emailDto.to, orgId, userId);
    } catch (error) {
      this.logger.error(
        `Email delivery failed: template=${templateName}, to=${emailDto.to}, error=${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Log failure to audit
      this.logEmailFailure(templateName, emailDto.to, orgId, userId, error);
    }
  }

  /**
   * Log successful email send to activity log and legal audit
   */
  private logEmailSuccess(
    templateName: string,
    recipient: string,
    orgId?: string,
    userId?: string,
  ): void {
    // Activity log (business-visible)
    if (orgId) {
      this.activityLog.logActivity({
        orgId,
        actorId: userId,
        action: 'email.sent',
        entityType: 'email',
        metadata: {
          template: templateName,
          recipient,
          status: 'sent',
        },
      });
    }

    // Legal audit (compliance)
    this.legalAudit.recordEvent({
      eventType: 'email.sent',
      orgId,
      triggerType: 'system',
      metadata: {
        template: templateName,
        recipientHash: this.hashEmail(recipient), // Don't store raw PII
      },
    });
  }

  /**
   * Log failed email send to activity log and legal audit
   */
  private logEmailFailure(
    templateName: string,
    recipient: string,
    orgId?: string,
    userId?: string,
    error?: unknown,
  ): void {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Activity log (business-visible)
    if (orgId) {
      this.activityLog.logActivity({
        orgId,
        actorId: userId,
        action: 'email.failed',
        entityType: 'email',
        metadata: {
          template: templateName,
          recipient,
          status: 'failed',
          error: errorMessage,
        },
      });
    }

    // Legal audit (compliance)
    this.legalAudit.recordEvent({
      eventType: 'email.failed',
      orgId,
      triggerType: 'system',
      metadata: {
        template: templateName,
        recipientHash: this.hashEmail(recipient),
        error: errorMessage,
      },
    });
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    // RFC 5321 caps valid addresses at 254 chars; this bounds worst-case regex
    // backtracking to O(n²) over a small constant, preventing ReDoS.
    if (email.length > 254) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Hash email for compliance logging (avoid storing raw PII)
   */
  private hashEmail(email: string): string {
    // Simple hash for demonstration (in production, use crypto.createHash)
    return `${email.length}_${email[0]}***${email[email.length - 1]}`;
  }
}
