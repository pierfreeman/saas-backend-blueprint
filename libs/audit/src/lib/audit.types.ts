import type { AuditSeverityLevel } from './audit-event-types.constants';

/** Options passed to AuditService.logEvent() */
export interface AuditLogOptions {
  /** Event type string (use AUDIT_EVENTS constants). */
  type: string;
  /** Organisation scope – nullable for global/system events. */
  orgId?: string | null;
  /** User who triggered the action – nullable for system-initiated events. */
  userId?: string | null;
  /** Arbitrary structured payload (sanitised before persistence). */
  payload?: Record<string, unknown>;
  /** Originating IP address (for GDPR access logs and security events). */
  ipAddress?: string | null;
  /** User-Agent header (for security anomaly detection). */
  userAgent?: string | null;
  /** Explicit severity; falls back to DEFAULT_SEVERITY_MAP or 'INFO'. */
  severity?: AuditSeverityLevel;
  /**
   * Correlation ID for distributed tracing (ties together all audit events
   * belonging to the same request / saga).
   */
  correlationId?: string | null;
}

/** Represents a persisted audit event record returned by query methods. */
export interface AuditEventRecord {
  id: string;
  type: string;
  severity: string;
  orgId: string | null;
  userId: string | null;
  payload: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  createdAt: Date;
}

/** Paginated result wrapper used by query methods. */
export interface PaginatedAuditResult {
  events: AuditEventRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** Query options for list methods. */
export interface AuditQueryOptions {
  limit?: number;
  offset?: number;
  /** Filter by event type prefix (e.g. 'auth.' matches all auth events). */
  typePrefix?: string;
  /** Filter by severity level. */
  severity?: AuditSeverityLevel;
  /** ISO datetime lower bound (inclusive). */
  fromDate?: Date;
  /** ISO datetime upper bound (inclusive). */
  toDate?: Date;
}
