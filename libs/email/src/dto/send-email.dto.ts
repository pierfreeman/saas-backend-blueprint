/**
 * Data Transfer Object for sending emails
 */
export interface SendEmailDto {
  /** Recipient email address */
  to: string;
  /** Email subject */
  subject: string;
  /** HTML body of the email */
  html: string;
  /** Plain text body (optional) */
  text?: string;
  /** Reply-to address (optional) */
  replyTo?: string;
}
