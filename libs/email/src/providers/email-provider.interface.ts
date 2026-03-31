import { SendEmailDto } from '../dto/send-email.dto';

export interface CreateContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  properties?: Record<string, string | number | null>;
}

/**
 * Email Provider Interface
 *
 * Abstraction for email delivery providers (Resend, SMTP, etc.)
 * This interface allows swapping providers without changing business logic.
 */
export interface EmailProvider {
  /**
   * Send an email
   * @param input Email payload
   * @throws Error if sending fails
   */
  sendEmail(input: SendEmailDto): Promise<void>;

  /**
   * Create a contact in the provider's audience/contact list.
   * Optional — providers that don't support contacts may omit this.
   */
  createContact?(input: CreateContactInput): Promise<void>;
}

/**
 * DI token for email provider
 */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
