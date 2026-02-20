import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { ConfigService } from '@nestjs/config';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: any;
  let eventBus: any;

  beforeEach(async () => {
    const mockPrisma = {
      subscription: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
      },
    };

    const mockEventBus = {
      emit: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'stripe.priceIdPro': 'price_pro',
          'stripe.priceIdEnterprise': 'price_enterprise',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
    prisma = module.get(PrismaService);
    eventBus = module.get(EventBusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findByOrgId', () => {
    it('should return subscription if found', async () => {
      const orgId = 'org-123';
      const mockSubscription = {
        id: 'sub-123',
        orgId,
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
      };

      prisma.subscription.findUnique.mockResolvedValue(mockSubscription);

      const result = await service.findByOrgId(orgId);

      expect(result).toEqual(mockSubscription);
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { orgId },
      });
    });

    it('should return null if subscription not found', async () => {
      const orgId = 'org-123';
      prisma.subscription.findUnique.mockResolvedValue(null);

      const result = await service.findByOrgId(orgId);

      expect(result).toBeNull();
    });
  });

  describe('createOrUpdateFromStripe', () => {
    it('should create new subscription from Stripe data', async () => {
      const mockOrg = {
        id: 'org-123',
        stripeCustomerId: 'cus_stripe123',
      };
      const mockStripeSubscription = {
        id: 'sub_stripe123',
        customer: 'cus_stripe123',
        status: 'active' as Stripe.Subscription.Status,
        current_period_end: 1735689600, // Jan 1, 2025
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_pro' } }],
        },
      } as unknown as Stripe.Subscription;
      const mockSubscription = {
        id: 'sub-123',
        orgId: mockOrg.id,
        stripeSubscriptionId: 'sub_stripe123',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue(mockSubscription);

      const result = await service.createOrUpdateFromStripe(mockStripeSubscription);

      expect(result).toEqual(mockSubscription);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_stripe123' },
      });
      expect(prisma.subscription.upsert).toHaveBeenCalledWith({
        where: { orgId: mockOrg.id },
        create: expect.objectContaining({
          orgId: mockOrg.id,
          stripeSubscriptionId: 'sub_stripe123',
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date(1735689600 * 1000),
        }),
        update: expect.objectContaining({
          stripeSubscriptionId: 'sub_stripe123',
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date(1735689600 * 1000),
        }),
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'subscription.updated',
          organizationId: mockOrg.id,
        }),
      );
    });

    it('should handle customer object instead of string ID', async () => {
      const mockOrg = {
        id: 'org-456',
        stripeCustomerId: 'cus_stripe456',
      };
      const mockStripeSubscription = {
        id: 'sub_stripe456',
        customer: { id: 'cus_stripe456' } as Stripe.Customer,
        status: 'active' as Stripe.Subscription.Status,
        current_period_end: 1735689600,
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_enterprise' } }],
        },
      } as unknown as Stripe.Subscription;
      const mockSubscription = {
        id: 'sub-456',
        orgId: mockOrg.id,
        plan: SubscriptionPlan.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue(mockSubscription);

      const result = await service.createOrUpdateFromStripe(mockStripeSubscription);

      expect(result.plan).toBe(SubscriptionPlan.ENTERPRISE);
      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { stripeCustomerId: 'cus_stripe456' },
      });
    });

    it('should throw error if organization not found', async () => {
      const mockStripeSubscription = {
        id: 'sub_stripe789',
        customer: 'cus_unknown',
        status: 'active' as Stripe.Subscription.Status,
        current_period_end: 1735689600,
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_pro' } }],
        },
      } as unknown as Stripe.Subscription;

      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.createOrUpdateFromStripe(mockStripeSubscription)).rejects.toThrow(
        'Organization not found for Stripe customer cus_unknown',
      );
    });

    it('should map canceled status correctly', async () => {
      const mockOrg = {
        id: 'org-canceled',
        stripeCustomerId: 'cus_canceled',
      };
      const mockStripeSubscription = {
        id: 'sub_canceled',
        customer: 'cus_canceled',
        status: 'canceled' as Stripe.Subscription.Status,
        current_period_end: 1735689600,
        cancel_at_period_end: true,
        items: {
          data: [{ price: { id: 'price_pro' } }],
        },
      } as unknown as Stripe.Subscription;
      const mockSubscription = {
        id: 'sub-canceled',
        orgId: mockOrg.id,
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.CANCELED,
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue(mockSubscription);

      const result = await service.createOrUpdateFromStripe(mockStripeSubscription);

      expect(result.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('should map FREE plan when no price ID', async () => {
      const mockOrg = {
        id: 'org-free',
        stripeCustomerId: 'cus_free',
      };
      const mockStripeSubscription = {
        id: 'sub_free',
        customer: 'cus_free',
        status: 'active' as Stripe.Subscription.Status,
        current_period_end: 1735689600,
        cancel_at_period_end: false,
        items: {
          data: [],
        },
      } as any as Stripe.Subscription;
      const mockSubscription = {
        id: 'sub-free',
        orgId: mockOrg.id,
        plan: SubscriptionPlan.FREE,
        status: SubscriptionStatus.ACTIVE,
      };

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue(mockSubscription);

      const result = await service.createOrUpdateFromStripe(mockStripeSubscription);

      expect(result.plan).toBe(SubscriptionPlan.FREE);
    });
  });

  describe('handleStripeWebhook', () => {
    it('should handle customer.subscription.created event', async () => {
      const mockOrg = { id: 'org-123', stripeCustomerId: 'cus_123' };
      const mockEvent = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            current_period_end: 1735689600,
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      } as unknown as Stripe.Event;

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue({});

      await service.handleStripeWebhook(mockEvent);

      expect(prisma.organization.findUnique).toHaveBeenCalled();
      expect(prisma.subscription.upsert).toHaveBeenCalled();
    });

    it('should handle customer.subscription.updated event', async () => {
      const mockOrg = { id: 'org-123', stripeCustomerId: 'cus_123' };
      const mockEvent = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'active',
            current_period_end: 1735689600,
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_enterprise' } }] },
          },
        },
      } as unknown as Stripe.Event;

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue({});

      await service.handleStripeWebhook(mockEvent);

      expect(prisma.subscription.upsert).toHaveBeenCalled();
    });

    it('should handle customer.subscription.deleted event', async () => {
      const mockOrg = { id: 'org-123', stripeCustomerId: 'cus_123' };
      const mockEvent = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_123',
            status: 'canceled',
            current_period_end: 1735689600,
            cancel_at_period_end: true,
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      } as unknown as Stripe.Event;

      prisma.organization.findUnique.mockResolvedValue(mockOrg);
      prisma.subscription.upsert.mockResolvedValue({});

      await service.handleStripeWebhook(mockEvent);

      expect(prisma.subscription.upsert).toHaveBeenCalled();
    });

    it('should handle checkout.session.completed event', async () => {
      const mockEvent = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_123',
            subscription: 'sub_123',
          },
        },
      } as Stripe.Event;

      await service.handleStripeWebhook(mockEvent);

      // Should not throw, just log
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('should handle unhandled event types gracefully', async () => {
      const mockEvent = {
        type: 'customer.created',
        data: {
          object: {},
        },
      } as Stripe.Event;

      await service.handleStripeWebhook(mockEvent);

      // Should not throw, just log
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('should throw error if webhook processing fails', async () => {
      const mockEvent = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            customer: 'cus_nonexistent',
            status: 'active',
            current_period_end: 1735689600,
            cancel_at_period_end: false,
            items: { data: [{ price: { id: 'price_pro' } }] },
          },
        },
      } as unknown as Stripe.Event;

      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(service.handleStripeWebhook(mockEvent)).rejects.toThrow();
    });
  });
});
