/**
 * Structured log context attached to every observability log entry.
 *
 * Fields are optional so that services without full tenant resolution
 * (e.g. bootstrap, migration jobs) can still log without errors.
 *
 * Multi-tenant safety: values are logged as-is. PII (names, emails) must
 * NEVER be placed here; use opaque IDs only.
 */
export interface LogContext {
  /** Resolved organization / tenant ID */
  tenantId?: string;
  /** Alias for tenantId — some code paths use orgId */
  orgId?: string;
  /** The RBAC role of the acting user (e.g. 'OWNER', 'ADMIN') */
  actorRole?: string;
  /** Internal DB user ID (not email / username) */
  userId?: string;
  /** Per-request trace ID for log correlation */
  requestId?: string;
  /** HTTP method when logging from an HTTP context */
  method?: string;
  /** URL path */
  path?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Arbitrary extra fields — must not contain PII */
  [key: string]: unknown;
}

/**
 * Subset of LogContext used for Sentry scope tagging.
 * Omits free-form index signature to keep Sentry tags structured.
 */
export interface SentryContext {
  tenantId?: string;
  orgId?: string;
  actorRole?: string;
  userId?: string;
  requestId?: string;
}
