/** Input to ActivityLogService.logActivity() */
export interface ActivityLogEvent {
  /** Organisation UUID — required. Every activity log entry is org-scoped. */
  orgId: string;
  /** Internal user UUID who triggered the action. Nullable for system actions. */
  actorId?: string | null;
  /** RBAC role of the actor at the time of the action (e.g. 'OWNER', 'ADMIN'). */
  actorRole?: string | null;
  /**
   * Dot-notation action string identifying what happened.
   * Examples: 'org.created', 'membership.role.changed', 'org.deleted'
   */
  action: string;
  /** Category of the entity the action was performed on (e.g. 'Organization', 'Membership'). */
  entityType?: string | null;
  /** UUID of the entity the action was performed on. */
  entityId?: string | null;
  /** Sanitised structured context. Must NOT contain PII or credentials. */
  metadata?: Record<string, unknown>;
}

/** A persisted activity log record returned by query methods. */
export interface ActivityLogRecord {
  id: string;
  orgId: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/** Paginated result wrapper used by findByOrg. */
export interface PaginatedActivityLogResult {
  logs: ActivityLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** Query options for findByOrg. */
export interface ActivityLogQueryOptions {
  limit?: number;
  offset?: number;
  /** Filter by exact action or action prefix (prefix match via startsWith). */
  action?: string;
  /** Filter by one or more specific action strings (exact match, OR logic). Takes precedence over action. */
  actions?: string[];
  /** Filter by entityType (e.g. 'Organization', 'Membership'). */
  entityType?: string;
  /** ISO datetime lower bound (inclusive). */
  fromDate?: Date;
  /** ISO datetime upper bound (inclusive). */
  toDate?: Date;
}
