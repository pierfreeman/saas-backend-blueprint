import type { ActivityLogRecord } from '@libs/activity-log';

// ── Re-export upstream types used by controllers ─────────────────────────────
export type { ActivityLogRecord } from '@libs/activity-log';

// ── Query filters ────────────────────────────────────────────────────────────

export interface GetOrgActivityQuery {
  limit?: number;
  offset?: number;
  /** Filter by action prefix (e.g. 'membership.' matches all membership events). */
  action?: string;
  fromDate?: Date;
  toDate?: Date;
}

export interface GetAllActivityQuery extends GetOrgActivityQuery {
  /** Narrow to a specific org when browsing cross-org logs. */
  orgId?: string;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface PaginatedAdminActivityResult {
  logs: ActivityLogRecord[];
  total: number;
  limit: number;
  offset: number;
}
