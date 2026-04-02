import { Injectable } from '@nestjs/common';
import {
  FeatureFlagsService,
  OrganizationEntitlements,
} from '@libs/feature-flags';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';

@Injectable()
export class AdminEntitlementsService {
  constructor(
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  getEntitlements(orgId: string): Promise<OrganizationEntitlements> {
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
}
