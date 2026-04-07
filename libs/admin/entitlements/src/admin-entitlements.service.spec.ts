import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminEntitlementsService } from './admin-entitlements.service';
import { FeatureFlagsService } from '@libs/feature-flags';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { UsersService } from '@libs/users';
import { OrganizationsService } from '@libs/organizations';
import type {
  OrganizationEntitlements,
  EntitlementOverrideRecord,
} from '@libs/feature-flags';

const mockEntitlements: OrganizationEntitlements = {
  organizationId: 'org-1',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  advancedAnalytics: true,
  customReports: true,
  apiAccess: true,
  ssoEnabled: false,
  prioritySupport: false,
  maxSeats: 10,
  storageLimitBytes: 5 * 1024 * 1024 * 1024,
};

const mockOverrideRecord: EntitlementOverrideRecord = {
  id: 'override-1',
  orgId: 'org-1',
  key: 'ssoEnabled',
  value: true,
  reason: 'Enterprise trial',
  expiresAt: null,
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AdminEntitlementsService', () => {
  let service: AdminEntitlementsService;
  const mockFeatureFlagsService = {
    getEntitlements: vi.fn(),
    invalidateEntitlements: vi.fn(),
    listOverrides: vi.fn(),
    setOverride: vi.fn(),
    deleteOverride: vi.fn(),
  };

  const mockActivityLog = {
    logActivity: vi.fn(),
  };

  const mockLegalAudit = {
    recordEvent: vi.fn(),
  };

  const mockUsersService = {
    findById: vi.fn(),
  };

  const mockOrganizationsService = {
    findById: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminEntitlementsService,
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: LegalAuditService, useValue: mockLegalAudit },
        { provide: UsersService, useValue: mockUsersService },
        { provide: OrganizationsService, useValue: mockOrganizationsService },
      ],
    }).compile();

    service = module.get(AdminEntitlementsService);
  });

  describe('getEntitlements', () => {
    it('delegates to FeatureFlagsService.getEntitlements', async () => {
      mockOrganizationsService.findById.mockResolvedValue({ id: 'org-1' });
      mockFeatureFlagsService.getEntitlements.mockResolvedValue(
        mockEntitlements,
      );

      const result = await service.getEntitlements('org-1');

      expect(mockOrganizationsService.findById).toHaveBeenCalledWith('org-1');
      expect(mockFeatureFlagsService.getEntitlements).toHaveBeenCalledWith(
        'org-1',
      );
      expect(result).toEqual(mockEntitlements);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockOrganizationsService.findById.mockRejectedValue(
        new NotFoundException('Organization org-none not found'),
      );

      await expect(service.getEntitlements('org-none')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFeatureFlagsService.getEntitlements).not.toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    it('delegates to FeatureFlagsService.invalidateEntitlements', async () => {
      mockFeatureFlagsService.invalidateEntitlements.mockResolvedValue(
        undefined,
      );

      await service.invalidateCache('org-1');

      expect(
        mockFeatureFlagsService.invalidateEntitlements,
      ).toHaveBeenCalledWith('org-1');
    });

    it('fires activityLog and legalAudit on invalidate', async () => {
      mockFeatureFlagsService.invalidateEntitlements.mockResolvedValue(
        undefined,
      );

      await service.invalidateCache('org-1', 'admin-user-1');

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'entitlements.cache.invalidated',
          orgId: 'org-1',
          actorId: 'admin-user-1',
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'entitlements.cache.invalidated',
          orgId: 'org-1',
        }),
      );
    });
  });

  // ── listOverrides ──────────────────────────────────────────────────────────

  describe('listOverrides', () => {
    it('delegates to FeatureFlagsService.listOverrides', async () => {
      mockFeatureFlagsService.listOverrides.mockResolvedValue([
        mockOverrideRecord,
      ]);
      mockUsersService.findById.mockResolvedValue({
        id: 'admin-1',
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
      });

      const result = await service.listOverrides('org-1');

      expect(mockFeatureFlagsService.listOverrides).toHaveBeenCalledWith(
        'org-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('ssoEnabled');
    });

    it('returns empty array when no overrides exist', async () => {
      mockFeatureFlagsService.listOverrides.mockResolvedValue([]);

      const result = await service.listOverrides('org-1');

      expect(result).toEqual([]);
    });
  });

  // ── setOverride ───────────────────────────────────────────────────────────

  describe('setOverride', () => {
    it('delegates to FeatureFlagsService.setOverride with createdBy and fires dual audit', async () => {
      mockFeatureFlagsService.setOverride.mockResolvedValue(mockOverrideRecord);

      const result = await service.setOverride(
        'org-1',
        { key: 'ssoEnabled', value: true, reason: 'Enterprise trial' },
        'admin-1',
      );

      expect(mockFeatureFlagsService.setOverride).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({
          key: 'ssoEnabled',
          value: true,
          reason: 'Enterprise trial',
          createdBy: 'admin-1',
        }),
      );
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'entitlements.override.set',
          orgId: 'org-1',
          actorId: 'admin-1',
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'entitlements.override.set',
          orgId: 'org-1',
        }),
      );
      expect(result.value).toBe(true);
    });
  });

  // ── deleteOverride ────────────────────────────────────────────────────────

  describe('deleteOverride', () => {
    it('delegates to FeatureFlagsService.deleteOverride and fires dual audit', async () => {
      mockFeatureFlagsService.deleteOverride.mockResolvedValue(undefined);

      await service.deleteOverride('org-1', 'ssoEnabled', 'admin-1');

      expect(mockFeatureFlagsService.deleteOverride).toHaveBeenCalledWith(
        'org-1',
        'ssoEnabled',
      );
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'entitlements.override.deleted' }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'entitlements.override.deleted',
          orgId: 'org-1',
        }),
      );
    });

    it('propagates NotFoundException from FeatureFlagsService.deleteOverride', async () => {
      mockFeatureFlagsService.deleteOverride.mockRejectedValue(
        new NotFoundException(
          `No entitlement override found for key 'ssoEnabled'`,
        ),
      );

      await expect(
        service.deleteOverride('org-1', 'ssoEnabled', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
