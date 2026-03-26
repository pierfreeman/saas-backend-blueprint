import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from '@libs/billing';
import { BillingStatus } from '@libs/billing';
import { Mocked, vi } from 'vitest';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-001';
const ACTOR_ID = 'user-uuid-001';

const makeSubscriptionEntity = () => ({
  orgId: ORG_ID,
  stripeCustomerId: 'cus_test',
  subscriptionId: 'sub_test',
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  storageLimit: null,
  subscriptionPeriodStart: new Date('2026-03-01'),
  subscriptionPeriodEnd: new Date('2026-04-01'),
  cancelAtPeriodEnd: false,
});

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('BillingController', () => {
  let controller: BillingController;
  let billingService: Mocked<BillingService>;

  beforeEach(() => {
    billingService = {
      createCheckoutSession: vi.fn(),
      createPortalSession: vi.fn(),
      getSubscription: vi.fn(),
      cancelSubscription: vi.fn(),
      getSubscriptionHistory: vi.fn(),
      ensureStripeCustomer: vi.fn(),
    } as unknown as Mocked<BillingService>;

    controller = new BillingController(billingService);
    vi.clearAllMocks();
  });

  // ─── POST /billing/checkout ─────────────────────────────────────────────

  describe('createCheckoutSession()', () => {
    it('delegates to BillingService and returns the checkout URL + sessionId', async () => {
      const response = {
        url: 'https://checkout.stripe.com/pay/cs_test',
        sessionId: 'cs_test',
      };
      billingService.createCheckoutSession.mockResolvedValue(response);

      const result = await controller.createCheckoutSession(
        {
          orgId: ORG_ID,
          priceId: 'price_pro',
          successUrl: 'https://app/success',
          cancelUrl: 'https://app/cancel',
        },
        ACTOR_ID,
        'idempotency-key-123',
      );

      expect(result).toEqual(response);
      expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
        ORG_ID,
        'price_pro',
        ACTOR_ID,
        {
          successUrl: 'https://app/success',
          cancelUrl: 'https://app/cancel',
          idempotencyKey: 'idempotency-key-123',
        },
      );
    });

    it('passes undefined idempotencyKey when header is absent', async () => {
      billingService.createCheckoutSession.mockResolvedValue({
        url: 'https://stripe.com',
        sessionId: 'cs_1',
      });

      await controller.createCheckoutSession(
        { orgId: ORG_ID, priceId: 'price_pro' },
        ACTOR_ID,
        undefined,
      );

      expect(billingService.createCheckoutSession).toHaveBeenCalledWith(
        ORG_ID,
        'price_pro',
        ACTOR_ID,
        expect.objectContaining({ idempotencyKey: undefined }),
      );
    });

    it('propagates BadRequestException when service throws', async () => {
      billingService.createCheckoutSession.mockRejectedValue(
        new BadRequestException('No Stripe customer'),
      );

      await expect(
        controller.createCheckoutSession(
          { orgId: ORG_ID, priceId: 'price_pro' },
          ACTOR_ID,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── POST /billing/portal ───────────────────────────────────────────────

  describe('createPortalSession()', () => {
    it('delegates to BillingService and returns the portal URL', async () => {
      billingService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/xxx',
      });

      const result = await controller.createPortalSession(
        { orgId: ORG_ID, returnUrl: 'https://app/billing' },
        ACTOR_ID,
      );

      expect(result).toEqual({ url: 'https://billing.stripe.com/session/xxx' });
      expect(billingService.createPortalSession).toHaveBeenCalledWith(
        ORG_ID,
        'https://app/billing',
        ACTOR_ID,
      );
    });

    it('passes undefined returnUrl when omitted from DTO', async () => {
      billingService.createPortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/yyy',
      });

      await controller.createPortalSession({ orgId: ORG_ID }, ACTOR_ID);

      expect(billingService.createPortalSession).toHaveBeenCalledWith(
        ORG_ID,
        undefined,
        ACTOR_ID,
      );
    });

    it('propagates BadRequestException when service throws', async () => {
      billingService.createPortalSession.mockRejectedValue(
        new BadRequestException('No Stripe customer'),
      );

      await expect(
        controller.createPortalSession({ orgId: ORG_ID }, ACTOR_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── GET /billing/subscription ──────────────────────────────────────────

  describe('getSubscription()', () => {
    it('delegates to BillingService and returns the subscription entity', async () => {
      const entity = makeSubscriptionEntity();
      billingService.getSubscription.mockResolvedValue(entity);

      const result = await controller.getSubscription(ORG_ID);

      expect(result).toBe(entity);
      expect(billingService.getSubscription).toHaveBeenCalledWith(ORG_ID);
    });

    it('propagates NotFoundException when org does not exist', async () => {
      billingService.getSubscription.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(controller.getSubscription('unknown-org')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── POST /billing/cancel ────────────────────────────────────────────────

  describe('cancelSubscription()', () => {
    it('calls BillingService and returns a confirmation message', async () => {
      billingService.cancelSubscription.mockResolvedValue(undefined);

      const result = await controller.cancelSubscription(
        { orgId: ORG_ID },
        ACTOR_ID,
      );

      expect(result).toEqual({
        message:
          'Subscription will be canceled at the end of the current period.',
      });
      expect(billingService.cancelSubscription).toHaveBeenCalledWith(
        ORG_ID,
        ACTOR_ID,
      );
    });

    it('propagates NotFoundException when org has no active subscription', async () => {
      billingService.cancelSubscription.mockRejectedValue(
        new NotFoundException('Organization has no active subscription'),
      );

      await expect(
        controller.cancelSubscription({ orgId: ORG_ID }, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /billing/history ────────────────────────────────────────────────

  describe('getSubscriptionHistory()', () => {
    const makeSnapshot = (n: number) => ({
      id: `snap-${n}`,
      orgId: ORG_ID,
      createdAt: new Date(),
      stripeSubscriptionId: `sub_${n}`,
      planId: 'price_pro',
      status: 'active',
      seats: 5,
      seatLimit: null,
      periodStart: new Date(),
      periodEnd: new Date(),
    });

    it('returns paginated history with parsed limit and offset', async () => {
      const snapshots = [makeSnapshot(1), makeSnapshot(2)];
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: snapshots,
        total: 2,
      });

      const result = await controller.getSubscriptionHistory(ORG_ID, '10', '5');

      expect(result).toEqual({
        items: snapshots,
        total: 2,
        limit: 10,
        offset: 5,
      });
      expect(billingService.getSubscriptionHistory).toHaveBeenCalledWith(
        ORG_ID,
        10,
        5,
      );
    });

    it('defaults to limit=50 and offset=0 when query params are absent', async () => {
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.getSubscriptionHistory(
        ORG_ID,
        undefined,
        undefined,
      );

      expect(result).toEqual({ items: [], total: 0, limit: 50, offset: 0 });
      expect(billingService.getSubscriptionHistory).toHaveBeenCalledWith(
        ORG_ID,
        50,
        0,
      );
    });

    it('clamps limit to maximum 200', async () => {
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.getSubscriptionHistory(
        ORG_ID,
        '999',
        '0',
      );

      expect(result.limit).toBe(200);
      expect(billingService.getSubscriptionHistory).toHaveBeenCalledWith(
        ORG_ID,
        200,
        0,
      );
    });

    it('falls back to default 50 when limit=0 (falsy parse result)', async () => {
      // Number.parseInt('0') || 50 === 50 because 0 is falsy
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.getSubscriptionHistory(ORG_ID, '0', '0');

      expect(result.limit).toBe(50);
    });

    it('clamps offset to minimum 0 when negative', async () => {
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.getSubscriptionHistory(
        ORG_ID,
        '50',
        '-10',
      );

      expect(result.offset).toBe(0);
      expect(billingService.getSubscriptionHistory).toHaveBeenCalledWith(
        ORG_ID,
        50,
        0,
      );
    });

    it('handles non-numeric query params gracefully (falls back to defaults)', async () => {
      billingService.getSubscriptionHistory.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.getSubscriptionHistory(
        ORG_ID,
        'abc',
        'xyz',
      );

      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('propagates NotFoundException when org does not exist', async () => {
      billingService.getSubscriptionHistory.mockRejectedValue(
        new NotFoundException('Organization not found'),
      );

      await expect(
        controller.getSubscriptionHistory('unknown-org', '50', '0'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
