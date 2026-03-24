import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailProvider } from './email-provider.interface';
import { SendEmailDto } from '../dto/send-email.dto';

/**
 * SMTP Email Provider
 *
 * Implements email delivery via any SMTP server (Mailpit, Mailtrap, etc.).
 * Suitable for local development; switch to SendGrid in production by setting
 * EMAIL_PROVIDER=sendgrid.
 */
@Injectable()
export class SmtpProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpProvider.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress =
      this.configService.get<string>('email.from.address') ??
      'noreply@localhost';
    this.fromName =
      this.configService.get<string>('email.from.name') ?? 'SaaS App';

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('email.smtp.host') ?? 'localhost',
      port: this.configService.get<number>('email.smtp.port') ?? 1025,
      secure: this.configService.get<boolean>('email.smtp.secure') ?? false,
      auth: this.configService.get<string>('email.smtp.auth.user')
        ? {
            user: this.configService.get<string>('email.smtp.auth.user'),
            pass: this.configService.get<string>('email.smtp.auth.pass'),
          }
        : undefined,
    });

    this.logger.log(
      `SMTP provider initialized — ${this.configService.get('email.smtp.host') ?? 'localhost'}:${this.configService.get('email.smtp.port') ?? 1025}`,
    );
  }

  async sendEmail(input: SendEmailDto): Promise<void> {
    await this.transporter.sendMail({
      from: `"${this.fromName}" <${this.fromAddress}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });

    this.logger.log(`Email sent via SMTP to ${input.to}`);
  }
}
