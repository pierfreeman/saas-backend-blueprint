/**
 * Audit Event Type Constants
 *
 * Organized by domain to support ISO 27001 (A.12.4 Logging and Monitoring)
 * and GDPR (Art. 5 – Accountability, Art. 30 – Records of Processing Activities,
 * Art. 32 – Security of Processing) compliance requirements.
 *
 * Severity guidance:
 *   CRITICAL – irreversible destructive operations, security breaches
 *   HIGH     – security events, privilege escalation, data deletion
 *   MEDIUM   – data modification, access control changes
 *   LOW      – read access, normal workflow events
 *   INFO     – informational background events
 */
export const AUDIT_EVENTS = {
  // ─── Identity & Access Management (ISO 27001 A.9) ──────────────────────────
  AUTH: {
    LOGIN_SUCCESS: 'auth.login.success',
    LOGIN_FAILED: 'auth.login.failed',
    LOGOUT: 'auth.logout',
    TOKEN_REFRESHED: 'auth.token.refreshed',
    TOKEN_REVOKED: 'auth.token.revoked',
    PASSWORD_CHANGED: 'auth.password.changed',
    PASSWORD_RESET_REQUESTED: 'auth.password.reset.requested',
    MFA_ENABLED: 'auth.mfa.enabled',
    MFA_DISABLED: 'auth.mfa.disabled',
  },

  // ─── User Management (GDPR Art. 17 – Right to erasure) ─────────────────────
  USER: {
    CREATED: 'user.created',
    UPDATED: 'user.updated',
    DELETED: 'user.deleted',
    PROFILE_VIEWED: 'user.profile.viewed',
    EMAIL_CHANGED: 'user.email.changed',
  },

  // ─── Organisation (ISO 27001 A.6 – Organisational controls) ────────────────
  ORGANIZATION: {
    CREATED: 'org.created',
    UPDATED: 'org.updated',
    DELETED: 'org.deleted',
    SUSPENDED: 'org.suspended',
    REACTIVATED: 'org.reactivated',
  },

  // ─── Membership / Access Control (ISO 27001 A.9.2) ─────────────────────────
  MEMBERSHIP: {
    CREATED: 'membership.created',
    ROLE_CHANGED: 'membership.role.changed',
    STATUS_CHANGED: 'membership.status.changed',
    DELETED: 'membership.deleted',
  },

  // ─── GDPR Data Subject Rights (Art. 15–22) ─────────────────────────────────
  GDPR: {
    DATA_EXPORT_REQUESTED: 'gdpr.data.export.requested',
    DATA_EXPORT_COMPLETED: 'gdpr.data.export.completed',
    DELETION_REQUESTED: 'gdpr.data.deletion.requested',
    DELETION_COMPLETED: 'gdpr.data.deletion.completed',
    CONSENT_GRANTED: 'gdpr.consent.granted',
    CONSENT_REVOKED: 'gdpr.consent.revoked',
    RECTIFICATION_REQUESTED: 'gdpr.rectification.requested',
    ACCESS_REQUEST_RECEIVED: 'gdpr.access.request.received',
  },

  // ─── Security Events (ISO 27001 A.12.4, A.16) ──────────────────────────────
  SECURITY: {
    ACCESS_DENIED: 'security.access.denied',
    SUSPICIOUS_ACTIVITY: 'security.suspicious.activity',
    RATE_LIMIT_EXCEEDED: 'security.rate.limit.exceeded',
    BLOCKED: 'security.blocked',
    IP_BLOCKED: 'security.ip.blocked',
    BRUTE_FORCE_DETECTED: 'security.brute.force.detected',
  },

  // ─── Billing (SOC 2 CC6.1 – Logical Access Controls) ──────────────────────
  BILLING: {
    SUBSCRIPTION_CREATED: 'billing.subscription.created',
    SUBSCRIPTION_UPDATED: 'billing.subscription.updated',
    SUBSCRIPTION_CANCELLED: 'billing.subscription.cancelled',
    SUBSCRIPTION_REACTIVATED: 'billing.subscription.reactivated',
    CHECKOUT_CREATED: 'billing.checkout.created',
    PORTAL_ACCESSED: 'billing.portal.accessed',
    PAYMENT_FAILED: 'billing.payment.failed',
    INVOICE_CREATED: 'billing.invoice.created',
  },

  // ─── System / Configuration (ISO 27001 A.12.1) ─────────────────────────────
  SYSTEM: {
    CONFIG_CHANGED: 'system.config.changed',
    MAINTENANCE_STARTED: 'system.maintenance.started',
    MAINTENANCE_ENDED: 'system.maintenance.ended',
  },
} as const;

/** Union type of every leaf audit event string. */
export type AuditEventType =
  (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS][keyof (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS]];

/** Severity levels aligned with ISO 27001 incident classification. */
export const AUDIT_SEVERITY = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
} as const;

export type AuditSeverityLevel = keyof typeof AUDIT_SEVERITY;

/**
 * Default severity mapping per event prefix.
 * Used by AuditService when the caller does not supply an explicit severity.
 */
export const DEFAULT_SEVERITY_MAP: Record<string, AuditSeverityLevel> = {
  'auth.login.failed': 'HIGH',
  'auth.password.changed': 'HIGH',
  'auth.mfa.disabled': 'HIGH',
  'auth.token.revoked': 'MEDIUM',
  'org.deleted': 'CRITICAL',
  'org.suspended': 'HIGH',
  'user.deleted': 'CRITICAL',
  'gdpr.data.deletion.requested': 'HIGH',
  'gdpr.data.deletion.completed': 'HIGH',
  'gdpr.data.export.requested': 'MEDIUM',
  'gdpr.consent.revoked': 'MEDIUM',
  'security.access.denied': 'HIGH',
  'security.suspicious.activity': 'CRITICAL',
  'security.blocked': 'HIGH',
  'security.brute.force.detected': 'CRITICAL',
  'security.rate.limit.exceeded': 'MEDIUM',
  'billing.subscription.cancelled': 'MEDIUM',
  'billing.payment.failed': 'HIGH',
  'membership.deleted': 'MEDIUM',
  'membership.role.changed': 'MEDIUM',
};
