/**
 * Available email template names
 */
export type EmailTemplateName =
  | 'user-invite'
  | 'auth-login-link'
  | 'export-ready'
  | 'org-deletion-confirmation'
  | 'system-alert'
  | 'billing-plan-upgraded'
  | 'billing-plan-downgraded'
  | 'billing-payment-received'
  | 'billing-plan-cancelled';

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
