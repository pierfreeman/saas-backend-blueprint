import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../infrastructure/repositories/billing.repository';
import { StripeService } from '../../infrastructure/stripe/stripe.service';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { BillingStatus } from '../../domain/enums/billing-status.enum';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';

const mockOrg = (): SubscriptionEntity => ({
  orgId: 'org-uuid-001',
  stripeCustomerId: 'cus_test_001',
  subscriptionId: null,
  billingStatus: BillingStatus.NONE,
  planId: null,
  seatCount: 1,
  storageLimit: null,
  subscriptionPeriodStart: null,
  subscriptionPeriodEnd: null,
  cancelAtPeriodEnd: false,
});

describe('BillingService', () => {
  let service: BillingService;
  let billingRepository: jest.Mocked<BillingRepository>;
  let stripeService: jest.Mocked<StripeService>;
  let activityLog: jest.Mocked<ActivityLogService>;
  let legalAudit: jest.Mocked<LegalAuditService>;
  let eventBus: jest.Mocked<EventBusService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: BillingRepository,
          useValue: {
            findOrgById: jest.fn(),
            updateOrgBillingData: jest.fn(),
            createBillingEvent: jest.fn(),
            findSnapshotsByOrgId: jest.fn(),
            findOrgMeta: jest.fn(),
          },
        },
        {
          provide: StripeService,
          useValue: {
            createCustomer: jest.fn(),
            createCheckoutSession: jest.fn(),
            createPortalSession: jest.fn(),
            cancelSubscription: jest.fn(),
          },
        },
        {
          provide: ActivityLogService,
          useValue: { logActivity: jest.fn() },
        },
        {
          provide: LegalAuditService,
          useValue: { recordEvent: jest.fn() },
        },
        {
          provide: EventBusService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(BillingService);
    billingRepository = module.get(BillingRepository);
    stripeService = module.get(StripeService);
    activityLog = module.get(ActivityLogService);
    legalAudit = module.get(LegalAuditService);
    eventBus = module.get(EventBusService);
    configService = module.get(ConfigService);
  });

  // ─── ensureStripeCustomer ────────────────────────────────────────────────────

  describe('ensureStripeCustomer', () => {
    it('returns existing stripeCustomerId without creating a new customer', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());

      const result = await service.ensureStripeCustomer(
        'org-uuid-001',
        'owner@test.com',
        'Test Org',
      );

      expect(result).toBe('cus_test_001');
      expect(stripeService.createCustomer).not.toHaveBeenCalled();
    });

    it('creates a Stripe customer when none exists', async () => {
      billingRepository.findOrgById.mockResolvedValue({
        ...mockOrg(),
        stripeCustomerId: null,
      });
      stripeService.createCustomer.mockResolvedValue({
        id: 'cus_new_001',
      } as never);
      billingRepository.updateOrgBillingData.mockResolvedValue(undefined);

      const result = await service.ensureStripeCustomer(
        'org-uuid-001',
        'owner@test.com',
        'Test Org',
      );

      expect(result).toBe('cus_new_001');
      expect(stripeService.createCustomer).toHaveBeenCalledWith(
        'owner@test.com',
        'Test Org',
        { orgId: 'org-uuid-001' },
      );
      expect(billingRepository.updateOrgBillingData).toHaveBeenCalledWith(
        'org-uuid-001',
        {
          stripeCustomerId: 'cus_new_001',
        },
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'billing.customer.created' }),
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.customer.created' }),
      );
    });
  });

  // ─── createCheckoutSession ───────────────────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('creates and returns a checkout session URL', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_test_001',
        url: 'https://checkout.stripe.com/pay/cs_test_001',
      } as never);
      configService.get.mockReturnValue('http://localhost:3000/success');

      const result = await service.createCheckoutSession(
        'org-uuid-001',
        'price_pro',
        'user-uuid-001',
      );

      expect(result.url).toBe('https://checkout.stripe.com/pay/cs_test_001');
      expect(result.sessionId).toBe('cs_test_001');
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.checkout.created' }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'billing.checkout.created' }),
      );
    });

    it('auto-provisions a Stripe customer when org has no stripeCustomerId', async () => {
      const orgWithoutCustomer = { ...mockOrg(), stripeCustomerId: null };
      const orgWithCustomer = mockOrg();
      billingRepository.findOrgById
        .mockResolvedValueOnce(orgWithoutCustomer) // initial fetch in createCheckoutSession
        .mockResolvedValueOnce(orgWithoutCustomer) // ensureStripeCustomer's own fetch
        .mockResolvedValueOnce(orgWithCustomer); // re-fetch after provision
      billingRepository.findOrgMeta.mockResolvedValue({
        name: 'Test Org',
        ownerEmail: 'owner@test.com',
      });
      stripeService.createCustomer.mockResolvedValue({
        id: 'cus_new_001',
      } as never);
      billingRepository.updateOrgBillingData.mockResolvedValue(undefined);
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_001',
        url: 'https://checkout.stripe.com/pay/cs_001',
      } as never);
      configService.get.mockReturnValue(undefined);

      const result = await service.createCheckoutSession(
        'org-uuid-001',
        'price_pro',
        'user-uuid-001',
      );

      expect(stripeService.createCustomer).toHaveBeenCalled();
      expect(result.url).toContain('checkout.stripe.com');
    });

    it('throws BadRequestException when checkout session has no URL', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());
      stripeService.createCheckoutSession.mockResolvedValue({
        id: 'cs_test_001',
        url: null,
      } as never);
      configService.get.mockReturnValue(undefined);

      await expect(
        service.createCheckoutSession(
          'org-uuid-001',
          'price_pro',
          'user-uuid-001',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── createPortalSession ─────────────────────────────────────────────────────

  describe('createPortalSession', () => {
    it('creates and returns a billing portal URL', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/xxx',
      } as never);
      configService.get.mockReturnValue('http://localhost:3000/billing');

      const result = await service.createPortalSession(
        'org-uuid-001',
        undefined,
        'user-uuid-001',
      );

      expect(result.url).toContain('billing.stripe.com');
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.portal.accessed' }),
      );
    });

    it('auto-provisions a Stripe customer when org has no stripeCustomerId', async () => {
      const orgWithoutCustomer = { ...mockOrg(), stripeCustomerId: null };
      const orgWithCustomer = mockOrg();
      billingRepository.findOrgById
        .mockResolvedValueOnce(orgWithoutCustomer) // initial fetch in createPortalSession
        .mockResolvedValueOnce(orgWithoutCustomer) // ensureStripeCustomer's own fetch
        .mockResolvedValueOnce(orgWithCustomer); // re-fetch after provision
      billingRepository.findOrgMeta.mockResolvedValue({
        name: 'Test Org',
        ownerEmail: 'owner@test.com',
      });
      stripeService.createCustomer.mockResolvedValue({
        id: 'cus_new_001',
      } as never);
      billingRepository.updateOrgBillingData.mockResolvedValue(undefined);
      stripeService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/xxx',
      } as never);
      configService.get.mockReturnValue(undefined);

      const result = await service.createPortalSession(
        'org-uuid-001',
        undefined,
        'user-uuid-001',
      );

      expect(stripeService.createCustomer).toHaveBeenCalled();
      expect(result.url).toContain('billing.stripe.com');
    });
  });

  // ─── cancelSubscription ──────────────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('cancels the subscription and dispatches the domain event', async () => {
      billingRepository.findOrgById.mockResolvedValue({
        ...mockOrg(),
        subscriptionId: 'sub_test_001',
        billingStatus: BillingStatus.ACTIVE,
      });
      stripeService.cancelSubscription.mockResolvedValue({} as never);
      billingRepository.updateOrgBillingData.mockResolvedValue(undefined);
      eventBus.publish.mockResolvedValue(undefined);

      await service.cancelSubscription('org-uuid-001', 'user-uuid-001');

      expect(stripeService.cancelSubscription).toHaveBeenCalledWith(
        'sub_test_001',
      );
      expect(billingRepository.updateOrgBillingData).toHaveBeenCalledWith(
        'org-uuid-001',
        {
          cancelAtPeriodEnd: true,
        },
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
        }),
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.canceled' }),
      );
    });

    it('throws NotFoundException when org has no active subscription', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());

      await expect(
        service.cancelSubscription('org-uuid-001', 'user-uuid-001'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getSubscription ─────────────────────────────────────────────────────────

  describe('getSubscription', () => {
    it('returns the subscription entity from the repository', async () => {
      const entity = mockOrg();
      billingRepository.findOrgById.mockResolvedValue(entity);

      const result = await service.getSubscription('org-uuid-001');

      expect(result).toEqual(entity);
      expect(billingRepository.findOrgById).toHaveBeenCalledWith(
        'org-uuid-001',
      );
    });
  });
  // ── getSubscriptionHistory ──────────────────────────────────────────────────────

  describe('getSubscriptionHistory', () => {
    it('returns paginated snapshots from the repository', async () => {
      billingRepository.findOrgById.mockResolvedValue(mockOrg());
      const snapshots = {
        items: [
          {
            id: 'snap-001',
            stripeSubscriptionId: 'sub_001',
            planId: 'price_pro',
            status: 'active',
            seats: 1,
            seatLimit: null,
            periodStart: new Date(),
            periodEnd: new Date(),
            createdAt: new Date(),
          },
        ],
        total: 1,
      };
      billingRepository.findSnapshotsByOrgId.mockResolvedValue(snapshots);

      const result = await service.getSubscriptionHistory(
        'org-uuid-001',
        10,
        0,
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(billingRepository.findOrgById).toHaveBeenCalledWith(
        'org-uuid-001',
      );
    });

    it('propagates NotFoundException when org does not exist', async () => {
      billingRepository.findOrgById.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        service.getSubscriptionHistory('org-uuid-missing', 10, 0),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
