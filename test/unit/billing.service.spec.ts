import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BillingService } from '../../src/modules/billing/billing.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StripeService } from '../../src/modules/billing/stripe.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { OrganizationStatus } from '@prisma/client';

describe('BillingService', () => {
  let service: BillingService;
  let prismaService: any;
  let stripeService: any;
  let eventBusService: any;

  const mockOrganization = {
    id: 'org-123',
    name: 'Test Organization',
    status: OrganizationStatus.ACTIVE,
    stripeCustomerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockStripeCustomer = {
    id: 'cus_123',
    object: 'customer' as const,
    email: `org-${mockOrganization.id}@placeholder.com`,
    name: mockOrganization.name,
    metadata: {
      organizationId: mockOrganization.id,
    },
  };

  const mockCheckoutSession = {
    id: 'cs_123',
    object: 'checkout.session' as const,
    url: 'https://checkout.stripe.com/session/cs_123',
  };

  const mockPortalSession = {
    id: 'ps_123',
    object: 'billing_portal.session' as const,
    url: 'https://billing.stripe.com/session/ps_123',
  };

  beforeEach(async () => {
    const mockPrisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    } as any;

    const mockStripe = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createBillingPortalSession: jest.fn(),
      cancelSubscription: jest.fn(),
      reactivateSubscription: jest.fn(),
    } as any;

    const mockEventBus = {
      emit: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: StripeService,
          useValue: mockStripe,
        },
        {
          provide: EventBusService,
          useValue: mockEventBus,
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prismaService = module.get(PrismaService);
    stripeService = module.get(StripeService);
    eventBusService = module.get(EventBusService);
  });

  describe('createStripeCustomer', () => {
    it('should create new stripe customer when organization has none', async () => {
      stripeService.createCustomer.mockResolvedValue(mockStripeCustomer as never);
      prismaService.organization.update.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: mockStripeCustomer.id,
      });

      const result = await service.createStripeCustomer(mockOrganization);

      expect(result).toBe(mockStripeCustomer.id);
      expect(stripeService.createCustomer).toHaveBeenCalledWith({
        email: `org-${mockOrganization.id}@placeholder.com`,
        name: mockOrganization.name,
        metadata: {
          organizationId: mockOrganization.id,
        },
      });
      expect(prismaService.organization.update).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
        data: { stripeCustomerId: mockStripeCustomer.id },
      });
    });

    it('should return existing customer id when already exists', async () => {
      const orgWithCustomer = {
        ...mockOrganization,
        stripeCustomerId: 'cus_existing',
      };

      const result = await service.createStripeCustomer(orgWithCustomer);

      expect(result).toBe('cus_existing');
      expect(stripeService.createCustomer).not.toHaveBeenCalled();
      expect(prismaService.organization.update).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateStripeCustomer', () => {
    it('should return existing customer id', async () => {
      const orgWithCustomer = {
        ...mockOrganization,
        stripeCustomerId: 'cus_existing',
      };
      prismaService.organization.findUnique.mockResolvedValue(orgWithCustomer);

      const result = await service.getOrCreateStripeCustomer(mockOrganization.id);

      expect(result).toBe('cus_existing');
      expect(stripeService.createCustomer).not.toHaveBeenCalled();
    });

    it('should create new customer when none exists', async () => {
      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      stripeService.createCustomer.mockResolvedValue(mockStripeCustomer as never);
      prismaService.organization.update.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: mockStripeCustomer.id,
      });

      const result = await service.getOrCreateStripeCustomer(mockOrganization.id);

      expect(result).toBe(mockStripeCustomer.id);
      expect(stripeService.createCustomer).toHaveBeenCalled();
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.getOrCreateStripeCustomer('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCheckoutSession', () => {
    it('should create checkout session with default URLs and emit audit event', async () => {
      const mockSessionWithAmount = {
        ...mockCheckoutSession,
        amount_total: 9900,
        currency: 'usd',
      };

      prismaService.organization.findUnique.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: 'cus_123',
      });
      stripeService.createCheckoutSession.mockResolvedValue(mockSessionWithAmount as never);

      const result = await service.createCheckoutSession(
        mockOrganization.id,
        'price_123',
        undefined,
        undefined,
        'user-123',
      );

      expect(result).toEqual(mockSessionWithAmount);
      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus_123',
          priceId: 'price_123',
          metadata: {
            organizationId: mockOrganization.id,
          },
        }),
      );
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.checkout.created',
          organizationId: mockOrganization.id,
          userId: 'user-123',
          payload: expect.objectContaining({
            sessionId: mockSessionWithAmount.id,
            priceId: 'price_123',
          }),
        }),
      );
    });

    it('should create checkout session with custom URLs', async () => {
      prismaService.organization.findUnique.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: 'cus_123',
      });
      stripeService.createCheckoutSession.mockResolvedValue(mockCheckoutSession as never);

      const successUrl = 'https://example.com/success';
      const cancelUrl = 'https://example.com/cancel';

      await service.createCheckoutSession(mockOrganization.id, 'price_123', successUrl, cancelUrl);

      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          successUrl,
          cancelUrl,
        }),
      );
    });

    it('should create customer if none exists', async () => {
      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      stripeService.createCustomer.mockResolvedValue(mockStripeCustomer as never);
      prismaService.organization.update.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: mockStripeCustomer.id,
      });
      stripeService.createCheckoutSession.mockResolvedValue(mockCheckoutSession as never);

      await service.createCheckoutSession(mockOrganization.id, 'price_123');

      expect(stripeService.createCustomer).toHaveBeenCalled();
      expect(stripeService.createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: mockStripeCustomer.id,
        }),
      );
    });
  });

  describe('createBillingPortalSession', () => {
    it('should create portal session with default return URL and emit audit event', async () => {
      prismaService.organization.findUnique.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: 'cus_123',
      });
      stripeService.createBillingPortalSession.mockResolvedValue(mockPortalSession as never);

      const result = await service.createBillingPortalSession(
        mockOrganization.id,
        undefined,
        'user-123',
      );

      expect(result).toEqual(mockPortalSession);
      expect(stripeService.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cus_123',
        }),
      );
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.portal.created',
          organizationId: mockOrganization.id,
          userId: 'user-123',
          payload: expect.objectContaining({
            sessionId: mockPortalSession.id,
          }),
        }),
      );
    });

    it('should create portal session with custom return URL', async () => {
      prismaService.organization.findUnique.mockResolvedValue({
        ...mockOrganization,
        stripeCustomerId: 'cus_123',
      });
      stripeService.createBillingPortalSession.mockResolvedValue(mockPortalSession as never);

      const returnUrl = 'https://example.com/billing';

      await service.createBillingPortalSession(mockOrganization.id, returnUrl);

      expect(stripeService.createBillingPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({
          returnUrl,
        }),
      );
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.createBillingPortalSession('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription at period end and emit audit event', async () => {
      const mockSubscription = {
        id: 'sub_123',
        stripeSubscriptionId: 'sub_stripe_123',
        orgId: mockOrganization.id,
      };

      prismaService.subscription.findUnique.mockResolvedValue(mockSubscription);
      stripeService.cancelSubscription.mockResolvedValue({} as never);
      prismaService.subscription.update.mockResolvedValue({
        ...mockSubscription,
        cancelAtPeriodEnd: true,
      });

      await service.cancelSubscription(mockOrganization.id, true, 'user-123');

      expect(stripeService.cancelSubscription).toHaveBeenCalledWith('sub_stripe_123', true);
      expect(prismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
        data: { cancelAtPeriodEnd: true },
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.subscription.cancelled',
          organizationId: mockOrganization.id,
          userId: 'user-123',
          payload: expect.objectContaining({
            subscriptionId: mockSubscription.id,
            cancelAtPeriodEnd: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException when subscription not found', async () => {
      prismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(service.cancelSubscription(mockOrganization.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reactivateSubscription', () => {
    it('should reactivate subscription and emit audit event', async () => {
      const mockSubscription = {
        id: 'sub_123',
        stripeSubscriptionId: 'sub_stripe_123',
        orgId: mockOrganization.id,
        cancelAtPeriodEnd: true,
      };

      prismaService.subscription.findUnique.mockResolvedValue(mockSubscription);
      stripeService.reactivateSubscription.mockResolvedValue({} as never);
      prismaService.subscription.update.mockResolvedValue({
        ...mockSubscription,
        cancelAtPeriodEnd: false,
      });

      await service.reactivateSubscription(mockOrganization.id, 'user-123');

      expect(stripeService.reactivateSubscription).toHaveBeenCalledWith('sub_stripe_123');
      expect(prismaService.subscription.update).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
        data: { cancelAtPeriodEnd: false },
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.subscription.reactivated',
          organizationId: mockOrganization.id,
          userId: 'user-123',
          payload: expect.objectContaining({
            subscriptionId: mockSubscription.id,
          }),
        }),
      );
    });

    it('should throw NotFoundException when subscription not found', async () => {
      prismaService.subscription.findUnique.mockResolvedValue(null);

      await expect(service.reactivateSubscription(mockOrganization.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
