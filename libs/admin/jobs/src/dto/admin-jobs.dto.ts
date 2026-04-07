import { JobStatus } from '@libs/prisma-business';

// ── Re-export upstream types ─────────────────────────────────────────────────
export { JobStatus } from '@libs/prisma-business';

// ── Query filters ────────────────────────────────────────────────────────────

export interface ListJobsQuery {
  limit?: number;
  offset?: number;
  status?: JobStatus;
  type?: string;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface AdminJobItem {
  id: string;
  orgId: string;
  userId: string | null;
  type: string;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedAdminJobsResult {
  items: AdminJobItem[];
  total: number;
  limit: number;
  offset: number;
}
