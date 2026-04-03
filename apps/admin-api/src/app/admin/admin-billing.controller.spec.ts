import { vi } from 'vitest';
import { AdminBillingController } from './admin-billing.controller';
import { AdminBillingService } from '@libs/admin/billing';
import { AdminGetPortalUrlDto } from './dto/admin.dto';

const mockAdminBillingService = {
  getBillingOverview: vi.fn(),
  getPortalUrl: vi.fn(),
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
});
