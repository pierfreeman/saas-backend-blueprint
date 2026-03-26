import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { RawBodyRequest } from '@nestjs/common';
import Stripe from 'stripe';
import { WebhookController } from './webhook.controller';
import {
  StripeService,
  WebhookDispatcherService,
  BillingService,
} from '@libs/billing';
import { LegalAuditService } from '@libs/legal-audit';
import { Mocked, vi } from 'vitest';

// ─── Helpers ────────────────────────────────────────────────────────────────

const RAW_BODY = Buffer.from(
  '{"id":"evt_001","type":"customer.subscription.updated"}',
);
const SIGNATURE = 'sig_test_001';

const makeStripeEvent = (overrides: Partial<Stripe.Event> = {}): Stripe.Event =>
  ({
    id: 'evt_001',
    object: 'event',
    type: 'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'sub_001',
        metadata: { orgId: 'org-001' },
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    api_version: '2025-01-27.acacia',
    ...overrides,
  }) as unknown as Stripe.Event;

const makeRequest = (rawBody?: Buffer): RawBodyRequest<Request> =>
  ({
    rawBody,
    headers: { 'content-type': 'application/json' },
  }) as unknown as RawBodyRequest<Request>;

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('WebhookController', () => {
  let controller: WebhookController;
  let stripeService: Mocked<StripeService>;
  let dispatcher: Mocked<WebhookDispatcherService>;
  let legalAudit: Mocked<LegalAuditService>;
  let billingService: Mocked<BillingService>;

  beforeEach(() => {
    stripeService = {
      constructWebhookEvent: vi.fn(),
    } as unknown as Mocked<StripeService>;

    dispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<WebhookDispatcherService>;

    legalAudit = {
      recordEvent: vi.fn(),
    } as unknown as Mocked<LegalAuditService>;

    billingService = {
      findBillingEvent: vi.fn(),
      createBillingEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<BillingService>;

    controller = new WebhookController(
      stripeService,
      dispatcher,
      legalAudit,
      billingService,
    );
    vi.clearAllMocks();
  });

  // ─── Input validation ───────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws BadRequestException when raw body is missing', async () => {
      legalAudit.recordEvent = vi.fn();

      await expect(
        controller.handleWebhook(makeRequest(undefined), SIGNATURE),
      ).rejects.toThrow(BadRequestException);

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'stripe.webhook.failed_verification',
        }),
      );
    });

    it('throws BadRequestException when stripe-signature header is missing', async () => {
      legalAudit.recordEvent = vi.fn();

      await expect(
        controller.handleWebhook(makeRequest(RAW_BODY), ''),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Signature verification ─────────────────────────────────────────────

  describe('signature verification', () => {
    it('throws BadRequestException when signature verification fails', async () => {
      stripeService.constructWebhookEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature');
      });
      legalAudit.recordEvent = vi.fn();

      await expect(
        controller.handleWebhook(makeRequest(RAW_BODY), 'bad-sig'),
      ).rejects.toThrow(BadRequestException);

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'stripe.webhook.failed_verification',
          metadata: expect.objectContaining({ reason: 'invalid_signature' }),
        }),
      );
    });

    it('records a verified audit entry after successful signature check', async () => {
      const event = makeStripeEvent();
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue(null);
      legalAudit.recordEvent = vi.fn();

      await controller.handleWebhook(makeRequest(RAW_BODY), SIGNATURE);

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'stripe.webhook.verified',
          metadata: expect.objectContaining({ stripeEventId: 'evt_001' }),
        }),
      );
    });
  });

  // ─── Idempotency check ──────────────────────────────────────────────────

  describe('idempotency', () => {
    it('returns { received: true } and skips dispatch for duplicate events', async () => {
      const event = makeStripeEvent();
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue({
        id: 'billing-evt-001',
      });

      const result = await controller.handleWebhook(
        makeRequest(RAW_BODY),
        SIGNATURE,
      );

      expect(result).toEqual({ received: true });
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(billingService.createBillingEvent).not.toHaveBeenCalled();
    });
  });

  // ─── Happy path ─────────────────────────────────────────────────────────

  describe('successful processing', () => {
    it('dispatches the event and returns { received: true }', async () => {
      const event = makeStripeEvent();
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue(null);

      const result = await controller.handleWebhook(
        makeRequest(RAW_BODY),
        SIGNATURE,
      );

      expect(dispatcher.dispatch).toHaveBeenCalledWith(event);
      expect(result).toEqual({ received: true });
    });

    it('stores a BillingEvent record with sha256 payload hash after processing', async () => {
      const event = makeStripeEvent();
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue(null);

      await controller.handleWebhook(makeRequest(RAW_BODY), SIGNATURE);

      const expectedHash = createHash('sha256').update(RAW_BODY).digest('hex');
      expect(billingService.createBillingEvent).toHaveBeenCalledWith(
        'evt_001',
        expectedHash,
        'org-001',
      );
    });

    it('passes undefined orgId when event metadata has no orgId', async () => {
      const event = makeStripeEvent();
      (event.data.object as unknown as Record<string, unknown>)['metadata'] =
        {};
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue(null);

      await controller.handleWebhook(makeRequest(RAW_BODY), SIGNATURE);

      expect(billingService.createBillingEvent).toHaveBeenCalledWith(
        'evt_001',
        expect.any(String),
        undefined,
      );
    });

    it('records stripe.webhook.received audit entry before any other step', async () => {
      const event = makeStripeEvent();
      stripeService.constructWebhookEvent.mockReturnValue(event);
      billingService.findBillingEvent.mockResolvedValue(null);
      const recordEvents: string[] = [];
      legalAudit.recordEvent = vi.fn().mockImplementation((e) => {
        recordEvents.push(e.eventType);
      });

      await controller.handleWebhook(makeRequest(RAW_BODY), SIGNATURE);

      expect(recordEvents[0]).toBe('stripe.webhook.received');
    });
  });
});
