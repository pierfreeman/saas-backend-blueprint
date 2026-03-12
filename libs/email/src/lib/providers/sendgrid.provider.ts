import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as SendGridMail from '@sendgrid/mail';
import { EmailProvider } from './email-provider.interface';
import { SendEmailDto } from '../dto/send-email.dto';

/**
 * SendGrid Email Provider
 *
 * Implements email delivery via SendGrid's API.
 * Initialized with API key from ConfigService.
 */
@Injectable()
export class SendGridProvider implements EmailProvider {
  private readonly logger = new Logger(SendGridProvider.name);
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('email.sendgrid.apiKey');
    this.fromAddress = this.configService.get<string>('email.from.address')!;
    this.fromName = this.configService.get<string>('email.from.name')!;

    if (!apiKey) {
      this.logger.warn(
        'SendGrid API key not configured. Email sending will fail.',
      );
    } else {
      SendGridMail.setApiKey(apiKey);
      this.logger.log('SendGrid provider initialized');
    }
  }

  /**
   * Send email via SendGrid
   */
  async sendEmail(input: SendEmailDto): Promise<void> {
    try {
      const message: SendGridMail.MailDataRequired = {
        to: input.to,
        from: {
          email: this.fromAddress,
          name: this.fromName,
        },
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      };

      await SendGridMail.send(message);

      this.logger.log(`Email sent successfully to ${input.to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${input.to}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Email delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
