import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AdminEntitlementsService } from './admin-entitlements.service';
import { FeatureFlagsService } from '@libs/feature-flags';
import type { OrganizationEntitlements } from '@libs/feature-flags';

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

describe('AdminEntitlementsService', () => {
  let service: AdminEntitlementsService;
  const mockFeatureFlagsService = {
    getEntitlements: vi.fn(),
    invalidateEntitlements: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminEntitlementsService,
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    service = module.get(AdminEntitlementsService);
  });

  describe('getEntitlements', () => {
    it('delegates to FeatureFlagsService.getEntitlements', async () => {
      mockFeatureFlagsService.getEntitlements.mockResolvedValue(
        mockEntitlements,
      );

      const result = await service.getEntitlements('org-1');

      expect(mockFeatureFlagsService.getEntitlements).toHaveBeenCalledWith(
        'org-1',
      );
      expect(result).toEqual(mockEntitlements);
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
  });
});
