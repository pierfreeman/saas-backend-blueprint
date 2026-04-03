import { Injectable, NotFoundException } from '@nestjs/common';
import type { Organization, BillingStatus } from '@libs/prisma-business';
import { MembershipRole, OrganizationStatus } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { FeatureFlagsService } from '@libs/feature-flags';
import { LegalAuditService } from '@libs/legal-audit';
import { InviteMemberService } from '@libs/memberships';
import { AdminOrganizationsRepository } from '../../infrastructure/repositories/admin-organizations.repository';
import type {
  AdminOrganizationDetail,
  AdminOrganizationListItem,
  ListOrganizationsFilters,
  ListOrganizationsPagination,
  PaginatedAdminOrganizationsResult,
} from '../../dto/admin-organizations.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const RECENT_ACTIVITY_COUNT = 5;
const SEARCH_MAX_LIMIT = 10;

@Injectable()
export class AdminOrganizationsService {
  constructor(
    private readonly repository: AdminOrganizationsRepository,
    private readonly activityLog: ActivityLogService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly legalAudit: LegalAuditService,
    private readonly inviteMemberService: InviteMemberService,
  ) {}

  /**
   * Returns a paginated list of all organizations with member counts.
   * Supports optional free-text search (name / ID) and status filter.
   */
  async listOrganizations(
    filters: ListOrganizationsFilters = {},
    pagination: Partial<ListOrganizationsPagination> = {},
  ): Promise<PaginatedAdminOrganizationsResult> {
    const limit = Math.min(pagination.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pagination.offset ?? 0;

    const { items, total } = await this.repository.findAll(filters, {
      limit,
      offset,
    });

    return {
      items: items.map((org) => this.toListItem(org)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns the full Customer 360 detail for a single organization:
   * org data + member count + recent activity + entitlements.
   *
   * @throws NotFoundException if no organization with the given ID exists.
   */
  async getOrganizationDetail(orgId: string): Promise<AdminOrganizationDetail> {
    const org = await this.repository.findByIdWithMemberCount(orgId);
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    const [recentActivityResult, entitlements] = await Promise.all([
      this.activityLog.findByOrg(orgId, {
        limit: RECENT_ACTIVITY_COUNT,
        offset: 0,
      }),
      this.featureFlags.getEntitlements(orgId),
    ]);

    return {
      ...this.toListItem(org),
      stripeCustomerId: org.stripeCustomerId ?? null,
      subscriptionId: org.subscriptionId ?? null,
      subscriptionPeriodEnd: org.subscriptionPeriodEnd ?? null,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
      recentActivity: recentActivityResult.logs,
      entitlements,
    };
  }

  /**
   * Quick name/ID search for global search typeahead.
   * Returns at most `limit` results (capped at SEARCH_MAX_LIMIT).
   */
  async searchOrganizations(
    query: string,
    limit = SEARCH_MAX_LIMIT,
  ): Promise<AdminOrganizationListItem[]> {
    const cap = Math.min(limit, SEARCH_MAX_LIMIT);
    const { items } = await this.repository.findAll(
      { search: query },
      { limit: cap, offset: 0 },
    );
    return items.map((org) => this.toListItem(org));
  }

  /**
   * Sets the lifecycle status of an organization (suspend or reactivate).
   * Invalidates the feature-flags cache so suspended orgs stop serving entitlements.
   *
   * @throws NotFoundException if no organization with the given ID exists.
   */
  async setOrgStatus(
    orgId: string,
    status: OrganizationStatus,
    reason: string | undefined,
    actorAdminId: string,
  ): Promise<AdminOrganizationListItem> {
    const existing = await this.repository.findByIdWithMemberCount(orgId);
    if (!existing) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    const updated = await this.repository.updateStatus(orgId, status);

    // Always invalidate the entitlements cache so the new status is reflected
    // immediately — important when suspending (block access) and reactivating.
    await this.featureFlags.invalidateEntitlements(orgId);

    const action =
      status === OrganizationStatus.SUSPENDED
        ? 'organization.suspended'
        : 'organization.reactivated';

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId,
      action,
      entityType: 'organization',
      entityId: orgId,
      metadata: { status, reason: reason ?? null },
    });

    this.legalAudit.recordEvent({
      eventType: action,
      orgId,
      triggerType: 'admin_action',
      metadata: { status, reason: reason ?? null, actorAdminId },
    });

    return this.toListItem(updated);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Synchronously provisions a new enterprise organization:
   * creates the org, sets the plan tier, and sends an ownership invite to
   * the specified email address. Returns the new org as a list item.
   */
  async provisionOrganization(
    dto: { name: string; ownerEmail: string; plan?: string },
    actorAdminId: string,
  ): Promise<AdminOrganizationListItem> {
    const org = await this.repository.createOrg(dto.name);

    if (dto.plan) {
      await this.repository.updatePlanId(org.id, dto.plan);
    }

    await this.inviteMemberService.invite(
      dto.ownerEmail,
      MembershipRole.OWNER,
      org.id,
      actorAdminId,
      'admin_action',
    );

    this.activityLog.logActivity({
      orgId: org.id,
      actorId: actorAdminId,
      action: 'organization.provisioned',
      entityType: 'organization',
      entityId: org.id,
      metadata: {
        name: dto.name,
        ownerEmail: dto.ownerEmail,
        plan: dto.plan ?? null,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'organization.provisioned',
      orgId: org.id,
      triggerType: 'admin_action',
      metadata: {
        name: dto.name,
        ownerEmail: dto.ownerEmail,
        plan: dto.plan ?? null,
        actorAdminId,
      },
    });

    return this.toListItem({
      ...org,
      planId: dto.plan ?? org.planId,
      _count: { memberships: 1 },
    });
  }

  private toListItem(
    org: Organization & { _count: { memberships: number } },
  ): AdminOrganizationListItem {
    return {
      id: org.id,
      name: org.name,
      status: org.status as OrganizationStatus,
      billingStatus: org.billingStatus as BillingStatus,
      planId: org.planId ?? null,
      membersCount: org._count.memberships,
      createdAt: org.createdAt,
    };
  }
}
