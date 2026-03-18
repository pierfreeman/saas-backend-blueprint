/**
 * Payload for org.export.requested event.
 * Emitted when a user requests an organization data export.
 */
export interface OrgExportRequestedEventPayload
  extends Record<string, unknown> {
  /** Organization ID */
  orgId: string;
  /** Export record ID */
  exportId: string;
  /** Job ID tracking the async processing */
  jobId: string;
  /** Auth0 subject of requesting user */
  requestedByUserId: string;
  /** Organization name (for logging) */
  orgName: string;
  /** Timestamp when export was requested */
  requestedAt: Date;
}

/**
 * Payload for org.export.started event.
 * Emitted when worker begins processing an export.
 */
export interface OrgExportStartedEventPayload extends Record<string, unknown> {
  /** Organization ID */
  orgId: string;
  /** Export record ID */
  exportId: string;
  /** Timestamp when processing started */
  startedAt: Date;
}

/**
 * Payload for org.export.completed event.
 * Emitted when export file is successfully generated and uploaded.
 */
export interface OrgExportCompletedEventPayload
  extends Record<string, unknown> {
  /** Organization ID */
  orgId: string;
  /** Export record ID */
  exportId: string;
  /** Organization name */
  orgName: string;
  /** User who requested the export */
  requestedByUserId: string;
  /** Timestamp when export was requested */
  requestedAt: Date;
  /** Timestamp when export completed */
  completedAt: Date;
  /** Size of export file in bytes */
  fileSize: bigint;
  /** Download URL */
  fileUrl: string;
  /** URL expiration timestamp */
  expiresAt: Date;
}

/**
 * Payload for org.export.failed event.
 * Emitted when export generation fails.
 */
export interface OrgExportFailedEventPayload extends Record<string, unknown> {
  /** Organization ID */
  orgId: string;
  /** Export record ID */
  exportId: string;
  /** Error message */
  error: string;
  /** Timestamp when export failed */
  failedAt: Date;
}
