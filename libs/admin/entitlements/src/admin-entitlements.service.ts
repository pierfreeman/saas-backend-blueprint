import { Injectable } from '@nestjs/common';
import {
  FeatureFlagsService,
  OrganizationEntitlements,
  EntitlementOverrideRecord,
  SetOverrideParams,
} from '@libs/feature-flags';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { UsersService } from '@libs/users';
import { OrganizationsService } from '@libs/organizations';

export type { EntitlementOverrideRecord, SetOverrideParams };

export interface EntitlementOverrideWithActor extends EntitlementOverrideRecord {
  createdByName: string;
}

@Injectable()
export class AdminEntitlementsService {
  constructor(
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async getEntitlements(orgId: string): Promise<OrganizationEntitlements> {
    // Throws NotFoundException if org does not exist.
    await this.organizationsService.findById(orgId);
    return this.featureFlagsService.getEntitlements(orgId);
  }

  async invalidateCache(orgId: string, actorAdminId?: string): Promise<void> {
    await this.featureFlagsService.invalidateEntitlements(orgId);

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId ?? 'system',
      action: 'entitlements.cache.invalidated',
      entityType: 'entitlements',
      metadata: { adminAction: true },
    });
    this.legalAudit.recordEvent({
      eventType: 'entitlements.cache.invalidated',
      orgId,
      userId: actorAdminId,
      triggerType: 'admin_action',
      metadata: { orgId },
    });
  }

  async listOverrides(orgId: string): Promise<EntitlementOverrideWithActor[]> {
    const records = await this.featureFlagsService.listOverrides(orgId);

    const uniqueIds = [
      ...new Set(records.map((r) => r.createdBy).filter(Boolean)),
    ];
    const users = await Promise.all(
      uniqueIds.map((id) => this.usersService.findById(id)),
    );
    const userMap = new Map(
      users
        .filter((u): u is NonNullable<typeof u> => u != null)
        .map((u) => [u.id, u]),
    );

    return records.map((r) => {
      const user = userMap.get(r.createdBy);
      const createdByName = user
        ? [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.email
        : r.createdBy;
      return { ...r, createdByName };
    });
  }

  async setOverride(
    orgId: string,
    params: SetOverrideParams,
    actorAdminId: string,
  ): Promise<EntitlementOverrideRecord> {
    const record = await this.featureFlagsService.setOverride(orgId, {
      ...params,
      createdBy: actorAdminId,
    });

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId,
      action: 'entitlements.override.set',
      entityType: 'entitlements',
      entityId: record.id,
      metadata: {
        key: params.key,
        value: params.value,
        reason: params.reason,
        adminAction: true,
      },
    });
    this.legalAudit.recordEvent({
      eventType: 'entitlements.override.set',
      orgId,
      userId: actorAdminId,
      triggerType: 'admin_action',
      metadata: { key: params.key, value: params.value, reason: params.reason },
    });

    return record;
  }

  async deleteOverride(
    orgId: string,
    key: string,
    actorAdminId: string,
  ): Promise<void> {
    // Throws NotFoundException if key does not exist (delegated to featureFlagsService → repository).
    await this.featureFlagsService.deleteOverride(orgId, key);

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId,
      action: 'entitlements.override.deleted',
      entityType: 'entitlements',
      metadata: { key, adminAction: true },
    });
    this.legalAudit.recordEvent({
      eventType: 'entitlements.override.deleted',
      orgId,
      userId: actorAdminId,
      triggerType: 'admin_action',
      metadata: { key },
    });
  }
}
