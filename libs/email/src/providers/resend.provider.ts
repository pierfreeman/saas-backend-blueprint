import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { EmailProvider } from './email-provider.interface';
import { SendEmailDto } from '../dto/send-email.dto';

/**
 * Resend Email Provider
 *
 * Implements email delivery via Resend's API.
 * Initialized with API key from ConfigService.
 */
@Injectable()
export class ResendProvider implements EmailProvider {
  private readonly logger = new Logger(ResendProvider.name);
  private readonly client: Resend;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('email.resend.apiKey');
    this.fromAddress = this.configService.get<string>('email.from.address')!;
    this.fromName = this.configService.get<string>('email.from.name')!;

    if (apiKey) {
      this.client = new Resend(apiKey);
      this.logger.log('Resend provider initialized');
    } else {
      this.client = new Resend('');
      this.logger.warn(
        'Resend API key not configured. Email sending will fail.',
      );
    }
  }

  /**
   * Send email via Resend
   */
  async sendEmail(input: SendEmailDto): Promise<void> {
    try {
      const { error } = await this.client.emails.send({
        from: `${this.fromName} <${this.fromAddress}>`,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      });

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log(`Email sent successfully to ${input.to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${input.to}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Email delivery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error },
      );
    }
  }
}
