import { vi } from 'vitest';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from '@libs/admin/billing';
import {
  AdminChangePlanDto,
  AdminExtendTrialDto,
  AdminGetPortalUrlDto,
} from './dto/admin.dto';

const mockAdminBillingService = {
  getBillingOverview: vi.fn(),
  getPortalUrl: vi.fn(),
  changePlan: vi.fn(),
  extendTrial: vi.fn(),
} as unknown as AdminBillingService;

const ACTOR_ADMIN_ID = 'admin-user-id';

describe('AdminBillingController', () => {
  let controller: AdminBillingController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminBillingController(mockAdminBillingService);
  });

  describe('getBillingOverview()', () => {
    it('delegates to service with orgId', async () => {
      const mockOverview = {
        orgId: 'org-1',
        plan: 'PRO',
        status: 'ACTIVE',
      };
      mockAdminBillingService.getBillingOverview = vi
        .fn()
        .mockResolvedValue(mockOverview);

      const result = await controller.getBillingOverview('org-1');

      expect(result).toBe(mockOverview);
      expect(mockAdminBillingService.getBillingOverview).toHaveBeenCalledWith(
        'org-1',
      );
    });

    it('propagates NotFoundException from the service', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockAdminBillingService.getBillingOverview = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Organization not found'));

      await expect(
        controller.getBillingOverview('nonexistent'),
      ).rejects.toThrow('Organization not found');
    });
  });

  describe('getPortalUrl()', () => {
    it('delegates to service with orgId, returnUrl, and actorAdminId', async () => {
      const mockPortal = { url: 'https://billing.stripe.com/session/123' };
      mockAdminBillingService.getPortalUrl = vi
        .fn()
        .mockResolvedValue(mockPortal);

      const dto: AdminGetPortalUrlDto = {
        returnUrl: 'https://app.example.com/admin',
      } as AdminGetPortalUrlDto;

      const result = await controller.getPortalUrl(
        'org-1',
        dto,
        ACTOR_ADMIN_ID,
      );

      expect(result).toBe(mockPortal);
      expect(mockAdminBillingService.getPortalUrl).toHaveBeenCalledWith({
        orgId: 'org-1',
        returnUrl: dto.returnUrl,
        actorAdminId: ACTOR_ADMIN_ID,
      });
    });
  });

  describe('changePlan()', () => {
    it('delegates to service with orgId, priceId, actorAdminId, and reason', async () => {
      mockAdminBillingService.changePlan = vi.fn().mockResolvedValue(undefined);

      const dto: AdminChangePlanDto = {
        priceId: 'price_enterprise',
        reason: 'Sales deal',
      } as AdminChangePlanDto;

      await controller.changePlan('org-1', dto, ACTOR_ADMIN_ID);

      expect(mockAdminBillingService.changePlan).toHaveBeenCalledWith(
        'org-1',
        'price_enterprise',
        ACTOR_ADMIN_ID,
        'Sales deal',
      );
    });

    it('works without optional reason field', async () => {
      mockAdminBillingService.changePlan = vi.fn().mockResolvedValue(undefined);

      const dto = { priceId: 'price_pro' } as AdminChangePlanDto;
      await controller.changePlan('org-1', dto, ACTOR_ADMIN_ID);

      expect(mockAdminBillingService.changePlan).toHaveBeenCalledWith(
        'org-1',
        'price_pro',
        ACTOR_ADMIN_ID,
        undefined,
      );
    });
  });

  describe('extendTrial()', () => {
    it('delegates to service with orgId, parsed Date, and actorAdminId', async () => {
      mockAdminBillingService.extendTrial = vi
        .fn()
        .mockResolvedValue(undefined);

      const dto: AdminExtendTrialDto = {
        trialEnd: '2025-12-31T23:59:59.000Z',
      } as AdminExtendTrialDto;

      await controller.extendTrial('org-1', dto, ACTOR_ADMIN_ID);

      expect(mockAdminBillingService.extendTrial).toHaveBeenCalledWith(
        'org-1',
        new Date('2025-12-31T23:59:59.000Z'),
        ACTOR_ADMIN_ID,
      );
    });
  });
});
