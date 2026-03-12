import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';
import type { EmailProvider } from './email-provider.interface';
import type { EmailConfig } from '@libs/config';

/**
 * SendGridProvider
 *
 * Implements the EmailProvider abstraction using the @sendgrid/mail SDK.
 * Configured via ConfigService (SENDGRID_API_KEY, EMAIL_FROM_ADDRESS, EMAIL_FROM_NAME).
 *
 * Error handling:
 *   - Provider errors are wrapped and re-thrown so EmailService can catch and
 *     audit-log them without crashing the caller.
 */
@Injectable()
export class SendGridProvider implements EmailProvider, OnModuleInit {
  private readonly logger = new Logger(SendGridProvider.name);
  private fromAddress!: string;
  private fromName!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const emailConfig = this.configService.get<EmailConfig['sendgrid']>(
      'email.sendgrid',
    );
    const apiKey = emailConfig?.apiKey ?? '';

    if (apiKey) {
      sgMail.setApiKey(apiKey);
    } else {
      this.logger.warn(
        'SENDGRID_API_KEY is not set — email sending will be skipped in this environment.',
      );
    }

    this.fromAddress =
      this.configService.get<string>('email.from.address') ??
      'noreply@example.com';
    this.fromName =
      this.configService.get<string>('email.from.name') ?? 'SaaS Platform';
  }

  async sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    const apiKey =
      this.configService.get<EmailConfig['sendgrid']>('email.sendgrid')
        ?.apiKey ?? '';

    if (!apiKey) {
      this.logger.warn(
        `Skipping email to "${input.to}" — SENDGRID_API_KEY not configured.`,
      );
      return;
    }

    const message: sgMail.MailDataRequired = {
      to: input.to,
      from: { email: this.fromAddress, name: this.fromName },
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
    };

    try {
      await sgMail.send(message);
      this.logger.log(`Email sent to "${input.to}" | subject: "${input.subject}"`);
    } catch (error: unknown) {
      const message_ =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.error(
        `SendGrid send failed to "${input.to}": ${message_}`,
      );
      throw new Error(`SendGrid delivery failed: ${message_}`);
    }
  }
}
