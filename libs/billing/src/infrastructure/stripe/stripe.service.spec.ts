import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import Stripe from 'stripe';
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

  // ── createPortalSession ─────────────────────────────────────────────────

  describe('createPortalSession', () => {
    it('creates a portal session with correct params', async () => {
      const session = {
        id: 'bps_test_001',
        url: 'https://billing.stripe.com/session/bps_test_001',
      };
      mockStripeInstance.billingPortal.sessions.create.mockResolvedValue(
        session,
      );

      const result = await service.createPortalSession(
        'cus_001',
        'https://app.test/settings/billing',
      );

      expect(result).toEqual(session);
      expect(
        mockStripeInstance.billingPortal.sessions.create,
      ).toHaveBeenCalledWith({
        customer: 'cus_001',
        return_url: 'https://app.test/settings/billing',
      });
    });

    it('throws InternalServerErrorException on Stripe API failure', async () => {
      mockStripeInstance.billingPortal.sessions.create.mockRejectedValue(
        new Error('Stripe error'),
      );

      await expect(
        service.createPortalSession('cus_001', 'https://app.test/billing'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── retrieveSubscription ────────────────────────────────────────────────

  describe('retrieveSubscription', () => {
    it('retrieves the subscription by ID', async () => {
      const sub = { id: 'sub_001', status: 'active' };
      mockStripeInstance.subscriptions.retrieve.mockResolvedValue(sub);

      const result = await service.retrieveSubscription('sub_001');

      expect(result).toEqual(sub);
      expect(mockStripeInstance.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_001',
      );
    });

    it('throws InternalServerErrorException on Stripe API failure', async () => {
      mockStripeInstance.subscriptions.retrieve.mockRejectedValue(
        new Error('Stripe error'),
      );

      await expect(service.retrieveSubscription('sub_001')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ── createCheckoutSession — idempotency key ─────────────────────────────

  describe('createCheckoutSession — idempotency', () => {
    it('forwards idempotencyKey as Stripe request option', async () => {
      const session = {
        id: 'cs_test_002',
        url: 'https://checkout.stripe.com/2',
      };
      mockStripeInstance.checkout.sessions.create.mockResolvedValue(session);

      await service.createCheckoutSession({
        customerId: 'cus_001',
        priceId: 'price_pro',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
        idempotencyKey: 'idem-key-abc123',
      });

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ idempotencyKey: 'idem-key-abc123' }),
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

  // ─── withRetry / exponential backoff ──────────────────────────────────────

  describe('withRetry — exponential backoff', () => {
    /**
     * Re-creates the service with base delay = 0 ms so tests run instantly,
     * and max retries = 2 (3 total attempts).
     */
    let fastService: StripeService;
    let fastMock: typeof mockStripeInstance;

    beforeEach(async () => {
      fastMock = {
        customers: { create: jest.fn() },
        checkout: { sessions: { create: jest.fn() } },
        billingPortal: { sessions: { create: jest.fn() } },
        subscriptions: { retrieve: jest.fn(), update: jest.fn() },
        webhooks: { constructEvent: jest.fn() },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StripeService,
          { provide: StripeClient, useValue: { stripe: fastMock } },
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'STRIPE_MAX_RETRIES') return 2;
                if (key === 'STRIPE_RETRY_BASE_DELAY_MS') return 0;
                if (key === 'STRIPE_WEBHOOK_SECRET') return 'whsec_test';
                return undefined;
              },
            },
          },
        ],
      }).compile();

      fastService = module.get(StripeService);
    });

    it('succeeds on first attempt without retrying', async () => {
      fastMock.customers.create.mockResolvedValue({ id: 'cus_1' });

      await fastService.createCustomer('a@b.com', 'Org');

      expect(fastMock.customers.create).toHaveBeenCalledTimes(1);
    });

    it('retries on StripeConnectionError and succeeds on the second attempt', async () => {
      const connError = new Stripe.errors.StripeConnectionError({
        message: 'Network timeout',
      } as Stripe.StripeRawError);
      fastMock.customers.create
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({ id: 'cus_1' });

      const result = await fastService.createCustomer('a@b.com', 'Org');

      expect(result).toEqual({ id: 'cus_1' });
      expect(fastMock.customers.create).toHaveBeenCalledTimes(2);
    });

    it('retries on StripeRateLimitError (HTTP 429)', async () => {
      const rateLimitError = new Stripe.errors.StripeRateLimitError({
        message: 'Too Many Requests',
        type: 'invalid_request_error',
      } as Stripe.StripeRawError);
      fastMock.customers.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ id: 'cus_2' });

      await fastService.createCustomer('a@b.com', 'Org');

      expect(fastMock.customers.create).toHaveBeenCalledTimes(2);
    });

    it('retries on StripeAPIError with HTTP 5xx status', async () => {
      const serverError = new Stripe.errors.StripeAPIError({
        message: 'Internal Server Error',
        statusCode: 500,
        type: 'api_error',
      } as Stripe.StripeRawError);
      fastMock.customers.create
        .mockRejectedValueOnce(serverError)
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ id: 'cus_3' }); // succeeds on 3rd attempt

      await fastService.createCustomer('a@b.com', 'Org');

      expect(fastMock.customers.create).toHaveBeenCalledTimes(3);
    });

    it('exhausts all retries and re-throws the last transient error as InternalServerErrorException', async () => {
      const connError = new Stripe.errors.StripeConnectionError({
        message: 'Network timeout',
      } as Stripe.StripeRawError);
      fastMock.customers.create.mockRejectedValue(connError);

      // maxRetries = 2 → 3 total calls
      await expect(
        fastService.createCustomer('a@b.com', 'Org'),
      ).rejects.toThrow('Failed to create billing customer');
      expect(fastMock.customers.create).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on StripeAuthenticationError (permanent failure)', async () => {
      const authError = new Stripe.errors.StripeAuthenticationError({
        message: 'No such API key',
        type: 'authentication_error',
      } as Stripe.StripeRawError);
      fastMock.customers.create.mockRejectedValue(authError);

      await expect(
        fastService.createCustomer('a@b.com', 'Org'),
      ).rejects.toThrow('Failed to create billing customer');
      // Should only be called once — no retries
      expect(fastMock.customers.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on StripeInvalidRequestError (bad input)', async () => {
      const invalidError = new Stripe.errors.StripeInvalidRequestError({
        message: 'No such price',
        type: 'invalid_request_error',
        param: 'price',
      } as Stripe.StripeRawError);
      fastMock.checkout.sessions.create.mockRejectedValue(invalidError);

      await expect(
        fastService.createCheckoutSession({
          customerId: 'cus_x',
          priceId: 'price_bad',
          successUrl: 'https://a.com/s',
          cancelUrl: 'https://a.com/c',
        }),
      ).rejects.toThrow('Failed to create checkout session');
      expect(fastMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('retries cancelSubscription on connection error', async () => {
      const connError = new Stripe.errors.StripeConnectionError({
        message: 'socket hang up',
      } as Stripe.StripeRawError);
      fastMock.subscriptions.update
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce({ id: 'sub_1', cancel_at_period_end: true });

      await fastService.cancelSubscription('sub_1');

      expect(fastMock.subscriptions.update).toHaveBeenCalledTimes(2);
    });
  });
});
