/**
 * Supported transactional email template names.
 * Each name corresponds to a `.hbs` file under `templates/`.
 */
export type EmailTemplateName =
  | 'auth-login-link'
  | 'user-invite'
  | 'export-ready'
  | 'system-alert';

/**
 * Data shape expected by each email template.
 */
export interface AuthLoginLinkData {
  loginUrl: string;
  recipientName?: string;
  expiresInMinutes?: number;
}

export interface UserInviteData {
  inviterName: string;
  orgName: string;
  inviteUrl: string;
  recipientName?: string;
  expiresInDays?: number;
}

export interface ExportReadyData {
  exportName: string;
  downloadUrl: string;
  recipientName?: string;
  expiresInHours?: number;
}

export interface SystemAlertData {
  alertType: string;
  message: string;
  recipientName?: string;
  orgName?: string;
  timestamp?: string;
}

/** Union type of all template data shapes. */
export type EmailTemplateData =
  | AuthLoginLinkData
  | UserInviteData
  | ExportReadyData
  | SystemAlertData
  | Record<string, unknown>;
