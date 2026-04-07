import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingStatus } from '@libs/prisma-business';
import { AdminBillingService } from './admin-billing.service';
import { AdminBillingRepository } from '../../infrastructure/repositories/admin-billing.repository';
import { BillingService, StripeService } from '@libs/billing';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';

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

  const mockStripeService = {
    updateSubscriptionPlan: vi.fn(),
    extendTrial: vi.fn(),
  };

  const mockActivityLog = { logActivity: vi.fn() };
  const mockLegalAudit = { recordEvent: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingService,
        { provide: AdminBillingRepository, useValue: mockRepository },
        { provide: BillingService, useValue: mockBillingService },
        { provide: StripeService, useValue: mockStripeService },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: LegalAuditService, useValue: mockLegalAudit },
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
    it('delegates to BillingService.createPortalSession when org has Stripe customer', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(
        mockOrgBillingFields,
      );
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

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(null);

      await expect(
        service.getPortalUrl({
          orgId: 'missing-id',
          returnUrl: 'https://app.example.com',
          actorAdminId: 'admin-1',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockBillingService.createPortalSession).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when org has no Stripe customer ID', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue({
        ...mockOrgBillingFields,
        stripeCustomerId: null,
      });

      await expect(
        service.getPortalUrl({
          orgId: 'org-1',
          returnUrl: 'https://app.example.com',
          actorAdminId: 'admin-1',
        }),
      ).rejects.toThrow('no Stripe customer ID');
      expect(mockBillingService.createPortalSession).not.toHaveBeenCalled();
    });
  });

  describe('changePlan', () => {
    it('calls updateSubscriptionPlan with the new price ID', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(
        mockOrgBillingFields,
      );
      mockStripeService.updateSubscriptionPlan.mockResolvedValue(undefined);

      await service.changePlan(
        'org-1',
        'price_enterprise',
        'admin-1',
        'Upgrade deal',
      );

      expect(mockStripeService.updateSubscriptionPlan).toHaveBeenCalledWith(
        'sub_xyz',
        'price_enterprise',
      );
    });

    it('logs activity and legal audit on success', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(
        mockOrgBillingFields,
      );
      mockStripeService.updateSubscriptionPlan.mockResolvedValue(undefined);

      await service.changePlan(
        'org-1',
        'price_enterprise',
        'admin-1',
        'Upgrade',
      );

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.plan.changed',
          orgId: 'org-1',
          metadata: expect.objectContaining({ newPriceId: 'price_enterprise' }),
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.plan.changed',
          triggerType: 'admin_action',
        }),
      );
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(null);

      await expect(
        service.changePlan('missing', 'price_pro', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when org has no subscription', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue({
        ...mockOrgBillingFields,
        subscriptionId: null,
      });

      await expect(
        service.changePlan('org-1', 'price_pro', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('extendTrial', () => {
    const trialingOrg = {
      ...mockOrgBillingFields,
      billingStatus: BillingStatus.TRIALING,
    };

    it('calls extendTrial on StripeService with correct args', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(trialingOrg);
      mockStripeService.extendTrial.mockResolvedValue(undefined);
      const trialEnd = new Date('2025-12-31');

      await service.extendTrial('org-1', trialEnd, 'admin-1');

      expect(mockStripeService.extendTrial).toHaveBeenCalledWith(
        'sub_xyz',
        trialEnd,
      );
    });

    it('logs activity and legal audit on success', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(trialingOrg);
      mockStripeService.extendTrial.mockResolvedValue(undefined);
      const trialEnd = new Date('2025-12-31');

      await service.extendTrial('org-1', trialEnd, 'admin-1');

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.trial.extended',
          orgId: 'org-1',
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.trial.extended',
          triggerType: 'admin_action',
        }),
      );
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(null);

      await expect(
        service.extendTrial('missing', new Date(), 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when org has no subscription', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue({
        ...trialingOrg,
        subscriptionId: null,
      });

      await expect(
        service.extendTrial('org-1', new Date(), 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when org is not TRIALING', async () => {
      mockRepository.findOrgBillingFields.mockResolvedValue(
        mockOrgBillingFields,
      ); // ACTIVE

      await expect(
        service.extendTrial('org-1', new Date(), 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
