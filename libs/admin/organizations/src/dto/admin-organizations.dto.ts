import type { BillingStatus, OrganizationStatus } from '@libs/prisma-business';
import type { ActivityLogRecord } from '@libs/activity-log';
import type { OrganizationEntitlements } from '@libs/feature-flags';

// ── Query filters ────────────────────────────────────────────────────────────

export interface ListOrganizationsFilters {
  /** Case-insensitive partial match on org name, or exact match on org ID. */
  search?: string;
  /** Filter by lifecycle status. */
  status?: OrganizationStatus;
}

export interface ListOrganizationsPagination {
  limit: number;
  offset: number;
}

// ── List response ────────────────────────────────────────────────────────────

export interface AdminOrganizationListItem {
  id: string;
  name: string;
  status: OrganizationStatus;
  billingStatus: BillingStatus;
  planId: string | null;
  membersCount: number;
  createdAt: Date;
}

export interface PaginatedAdminOrganizationsResult {
  items: AdminOrganizationListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ── Detail / Customer 360 ────────────────────────────────────────────────────

export interface AdminOrganizationDetail extends AdminOrganizationListItem {
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  subscriptionPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  recentActivity: ActivityLogRecord[];
  entitlements: OrganizationEntitlements;
  // ── Deletion fields ──────────────────────────────────────────────────────
  deletionRequestedAt: Date | null;
  deletionScheduledAt: Date | null;
  deletionCompletedAt: Date | null;
  retentionPeriodDays: number | null;
}
