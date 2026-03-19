/**
 * Available email template names
 */
export type EmailTemplateName =
  | 'user-invite'
  | 'auth-login-link'
  | 'export-ready'
  | 'system-alert';

/**
 * Email template data interface
 */
export interface EmailTemplateData {
  [key: string]: unknown;
}

/**
 * Email send status
 */
export enum EmailStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  BOUNCED = 'bounced',
}
