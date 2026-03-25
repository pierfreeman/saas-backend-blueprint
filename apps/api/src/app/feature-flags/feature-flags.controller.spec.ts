import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { BillingStatus } from '@prisma/client';
import { OrganizationEntitlements } from './interfaces/entitlements.interface';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-001';

const makeEntitlements = (
  overrides?: Partial<OrganizationEntitlements>,
): OrganizationEntitlements => ({
  organizationId: ORG_ID,
  plan: 'FREE',
  subscriptionStatus: BillingStatus.NONE,
  advancedAnalytics: false,
  customReports: false,
  apiAccess: false,
  ssoEnabled: false,
  prioritySupport: false,
  maxSeats: 3,
  ...overrides,
});

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  let service: jest.Mocked<FeatureFlagsService>;

  beforeEach(() => {
    service = {
      getEntitlements: jest.fn(),
      invalidateEntitlements: jest.fn(),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    controller = new FeatureFlagsController(service);
    jest.clearAllMocks();
  });

  // ─── GET /organizations/:orgId/entitlements ───────────────────────────────

  describe('getEntitlements()', () => {
    it('delegates to FeatureFlagsService and returns the entitlements', async () => {
      const entitlements = makeEntitlements({ plan: 'PRO' });
      service.getEntitlements.mockResolvedValue(entitlements);

      const result = await controller.getEntitlements(ORG_ID);

      expect(result).toBe(entitlements);
      expect(service.getEntitlements).toHaveBeenCalledWith(ORG_ID);
    });

    it('returns FREE-tier entitlements when the org has no subscription', async () => {
      const entitlements = makeEntitlements();
      service.getEntitlements.mockResolvedValue(entitlements);

      const result = await controller.getEntitlements(ORG_ID);

      expect(result.plan).toBe('FREE');
      expect(result.advancedAnalytics).toBe(false);
    });

    it('propagates errors thrown by the service', async () => {
      service.getEntitlements.mockRejectedValue(new Error('Redis down'));

      await expect(controller.getEntitlements(ORG_ID)).rejects.toThrow(
        'Redis down',
      );
    });
  });

  // ─── POST /organizations/:orgId/entitlements/invalidate ───────────────────

  describe('invalidateCache()', () => {
    it('calls invalidateEntitlements and returns a confirmation message', async () => {
      service.invalidateEntitlements.mockResolvedValue(undefined);

      const result = await controller.invalidateCache(ORG_ID);

      expect(service.invalidateEntitlements).toHaveBeenCalledWith(ORG_ID);
      expect(result).toEqual({
        message: `Entitlements cache invalidated for organization ${ORG_ID}`,
      });
    });

    it('propagates errors thrown by the service', async () => {
      service.invalidateEntitlements.mockRejectedValue(
        new Error('Cache error'),
      );

      await expect(controller.invalidateCache(ORG_ID)).rejects.toThrow(
        'Cache error',
      );
    });
  });
});
