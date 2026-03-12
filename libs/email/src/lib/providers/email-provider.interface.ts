/**
 * EmailProvider
 *
 * Abstraction over transactional email delivery.
 * Implement this interface to add new providers (AWS SES, Postmark, Resend, etc.).
 */
export interface EmailProvider {
  /**
   * Sends a transactional email.
   * Throws on unrecoverable provider errors.
   */
  sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void>;
}

/** DI injection token for the active EmailProvider. */
export const EMAIL_PROVIDER_TOKEN = 'EMAIL_PROVIDER';
