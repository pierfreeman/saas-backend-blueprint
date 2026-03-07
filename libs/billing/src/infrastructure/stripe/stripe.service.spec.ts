import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeClient } from './stripe.client';

/**
 * Unit tests for StripeService.
 * All Stripe SDK calls are mocked via StripeClient.
 */
describe('StripeService', () => {
  let service: StripeService;
  let mockStripeInstance: {
    customers: { create: jest.Mock };
    checkout: { sessions: { create: jest.Mock } };
    billingPortal: { sessions: { create: jest.Mock } };
    subscriptions: { retrieve: jest.Mock; update: jest.Mock };
    webhooks: { constructEvent: jest.Mock };
  };

  beforeEach(async () => {
    mockStripeInstance = {
      customers: { create: jest.fn() },
      checkout: { sessions: { create: jest.fn() } },
      billingPortal: { sessions: { create: jest.fn() } },
      subscriptions: { retrieve: jest.fn(), update: jest.fn() },
      webhooks: { constructEvent: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: StripeClient,
          useValue: {
            stripe: mockStripeInstance,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test_secret';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(StripeService);
  });

  // ─── createCustomer ──────────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('calls stripe.customers.create with correct params', async () => {
      const customer = { id: 'cus_new_001' };
      mockStripeInstance.customers.create.mockResolvedValue(customer);

      const result = await service.createCustomer(
        'owner@test.com',
        'Test Org',
        {
          orgId: 'org-001',
        },
      );

      expect(result).toEqual(customer);
      expect(mockStripeInstance.customers.create).toHaveBeenCalledWith({
        email: 'owner@test.com',
        name: 'Test Org',
        metadata: { orgId: 'org-001' },
      });
    });

    it('throws InternalServerErrorException on Stripe API failure', async () => {
      mockStripeInstance.customers.create.mockRejectedValue(
        new Error('Stripe error'),
      );

      await expect(
        service.createCustomer('owner@test.com', 'Test Org'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── createCheckoutSession ───────────────────────────────────────────────────

  describe('createCheckoutSession', () => {
    it('creates a checkout session with correct params', async () => {
      const session = {
        id: 'cs_test_001',
        url: 'https://checkout.stripe.com/xxx',
      };
      mockStripeInstance.checkout.sessions.create.mockResolvedValue(session);

      const result = await service.createCheckoutSession({
        customerId: 'cus_001',
        priceId: 'price_pro',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
        metadata: { orgId: 'org-001' },
      });

      expect(result).toEqual(session);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_001',
          mode: 'subscription',
          line_items: [{ price: 'price_pro', quantity: 1 }],
        }),
        expect.objectContaining({}),
      );
    });

    it('throws InternalServerErrorException on Stripe API failure', async () => {
      mockStripeInstance.checkout.sessions.create.mockRejectedValue(
        new Error('Stripe error'),
      );

      await expect(
        service.createCheckoutSession({
          customerId: 'cus_001',
          priceId: 'price_pro',
          successUrl: 'http://test.com/success',
          cancelUrl: 'http://test.com/cancel',
        }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ─── cancelSubscription ─────────────────────────────────────────────────────

  describe('cancelSubscription', () => {
    it('sets cancel_at_period_end on the subscription', async () => {
      const sub = { id: 'sub_001', cancel_at_period_end: true };
      mockStripeInstance.subscriptions.update.mockResolvedValue(sub);

      const result = await service.cancelSubscription('sub_001');

      expect(result).toEqual(sub);
      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        'sub_001',
        {
          cancel_at_period_end: true,
        },
      );
    });

    it('throws InternalServerErrorException on Stripe API failure', async () => {
      mockStripeInstance.subscriptions.update.mockRejectedValue(
        new Error('Stripe error'),
      );

      await expect(service.cancelSubscription('sub_001')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ─── constructWebhookEvent ───────────────────────────────────────────────────

  describe('constructWebhookEvent', () => {
    it('verifies signature and constructs the event', () => {
      const fakeEvent = { id: 'evt_001', type: 'invoice.payment_succeeded' };
      mockStripeInstance.webhooks.constructEvent.mockReturnValue(fakeEvent);

      const result = service.constructWebhookEvent(
        Buffer.from('{"id":"evt_001"}'),
        't=123,v1=abc',
      );

      expect(result).toEqual(fakeEvent);
      expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
        expect.any(Buffer),
        't=123,v1=abc',
        'whsec_test_secret',
      );
    });

    it('throws when STRIPE_WEBHOOK_SECRET is not configured', () => {
      const moduleRef = Test.createTestingModule({
        providers: [
          StripeService,
          { provide: StripeClient, useValue: { stripe: mockStripeInstance } },
          {
            provide: ConfigService,
            useValue: { get: jest.fn().mockReturnValue(undefined) },
          },
        ],
      });

      return moduleRef.compile().then((m) => {
        const svcNoSecret = m.get(StripeService);
        expect(() =>
          svcNoSecret.constructWebhookEvent(Buffer.from('{}'), 't=1'),
        ).toThrow('STRIPE_WEBHOOK_SECRET is not configured');
      });
    });
  });
});
