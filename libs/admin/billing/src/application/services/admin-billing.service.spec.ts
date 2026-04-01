import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BillingStatus } from '@libs/prisma-business';
import { AdminBillingService } from './admin-billing.service';
import { AdminBillingRepository } from '../../infrastructure/repositories/admin-billing.repository';
import { BillingService } from '@libs/billing';

const mockOrgBillingFields = {
  id: 'org-1',
  stripeCustomerId: 'cus_abc',
  subscriptionId: 'sub_xyz',
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  storageLimit: BigInt(5 * 1024 * 1024 * 1024),
  subscriptionPeriodStart: new Date('2024-01-01'),
  subscriptionPeriodEnd: new Date('2025-01-01'),
  cancelAtPeriodEnd: false,
};

describe('AdminBillingService', () => {
  let service: AdminBillingService;

  const mockRepository = {
    findOrgBillingFields: vi.fn(),
  };

  const mockBillingService = {
    createPortalSession: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingService,
        { provide: AdminBillingRepository, useValue: mockRepository },
        { provide: BillingService, useValue: mockBillingService },
      ],
    }).compile();

    service = module.get(AdminBillingService);
  });

  describe('getBillingOverview', () => {
    it('returns billing overview when org exists', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(
        mockOrgBillingFields,
      );

      const result = await service.getBillingOverview('org-1');

      expect(result.orgId).toBe('org-1');
      expect(result.stripeCustomerId).toBe('cus_abc');
      expect(result.billingStatus).toBe(BillingStatus.ACTIVE);
      expect(result.planId).toBe('price_pro');
      expect(result.cancelAtPeriodEnd).toBe(false);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(null);

      await expect(service.getBillingOverview('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('maps null-ish billing fields safely', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue({
        ...mockOrgBillingFields,
        stripeCustomerId: null,
        subscriptionId: null,
        planId: null,
        storageLimit: null,
        subscriptionPeriodStart: null,
        subscriptionPeriodEnd: null,
        billingStatus: BillingStatus.NONE,
      });

      const result = await service.getBillingOverview('org-1');

      expect(result.stripeCustomerId).toBeNull();
      expect(result.subscriptionId).toBeNull();
      expect(result.billingStatus).toBe(BillingStatus.NONE);
    });
  });

  describe('getPortalUrl', () => {
    it('delegates to BillingService.createPortalSession', async () => {
      mockBillingService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/abc',
      });

      const result = await service.getPortalUrl({
        orgId: 'org-1',
        returnUrl: 'https://app.example.com/settings/billing',
        actorAdminId: 'admin-user-1',
      });

      expect(mockBillingService.createPortalSession).toHaveBeenCalledWith(
        'org-1',
        'https://app.example.com/settings/billing',
        'admin-user-1',
      );
      expect(result.url).toContain('stripe.com');
    });
  });
});
