import { SendEmailDto } from '../dto/send-email.dto';

/**
 * Email Provider Interface
 *
 * Abstraction for email delivery providers (SendGrid, AWS SES, Postmark, etc.)
 * This interface allows swapping providers without changing business logic.
 */
export interface EmailProvider {
  /**
   * Send an email
   * @param input Email payload
   * @throws Error if sending fails
   */
  sendEmail(input: SendEmailDto): Promise<void>;
}

/**
 * DI token for email provider
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
