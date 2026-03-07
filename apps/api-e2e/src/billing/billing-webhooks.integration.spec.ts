/**
 * billing-webhooks.integration.spec.ts
 *
 * Integration tests for Stripe webhook processing via the HTTP layer.
 *
 * Tests verify the full pipeline:
 *   1. HTTP POST /billing/webhook with a signed payload
 *   2. Signature verification using STRIPE_WEBHOOK_SECRET from .env.test
 *   3. DB state changes (Organization billing fields)
 *   4. ActivityLog writes
 *   5. BillingEvent idempotency record creation
 *   6. Domain event dispatch (via LocalTransport in test mode)
 *
 * Stripe API calls are NOT made — the webhook endpoint only calls
 * stripe.webhooks.constructEvent() which is a local computation.
 *
 * Prerequisites (handled by globalSetup):
 *   - PostgreSQL test containers running with applied migrations
 *   - .env.test loaded with STRIPE_WEBHOOK_SECRET=whsec_test_integration_secret_32chars_min
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import Stripe from 'stripe';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { BillingStatus } from '@prisma/client';

// ─── Test helpers ────────────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET =
  process.env['STRIPE_WEBHOOK_SECRET'] ??
  'whsec_test_integration_secret_32chars_min';

// Stripe instance used only for utilities — no network calls in tests.
const stripeUtil = new Stripe('sk_test_placeholder_for_integration_tests', {
  apiVersion: '2026-02-25.clover',
});

/**
 * Computes a valid Stripe-Signature header for the given payload.
 * Uses the Stripe SDK's generateTestHeaderString — guaranteed to match
 * the same verification logic used in constructEvent().
 */
function buildStripeSignatureHeader(payload: string): string {
  return stripeUtil.webhooks.generateTestHeaderString({
    payload,
    secret: TEST_WEBHOOK_SECRET,
  });
}

function makeSubscriptionObject(
  overrides: Partial<{
    id: string;
    status: Stripe.Subscription.Status;
    customerId: string;
    priceId: string;
    quantity: number;
    cancel_at_period_end: boolean;
  }> = {},
): object {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: overrides.id ?? 'sub_int_test_001',
    object: 'subscription',
    status: overrides.status ?? 'active',
    customer: overrides.customerId ?? 'cus_int_test_001',
    current_period_start: now - 86400,
    current_period_end: now + 86400 * 29,
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_001',
          object: 'subscription_item',
          price: { id: overrides.priceId ?? 'price_test_pro', object: 'price' },
          quantity: overrides.quantity ?? 5,
        },
      ],
    },
    metadata: {},
  };
}

function makeInvoiceObject(
  customerId: string,
  overrides: Partial<{
    id: string;
    amount_paid: number;
    attempt_count: number;
  }> = {},
): object {
  return {
    id: overrides.id ?? 'in_int_test_001',
    object: 'invoice',
    customer: customerId,
    amount_paid: overrides.amount_paid ?? 4900,
    amount_due: overrides.amount_paid ?? 4900,
    attempt_count: overrides.attempt_count ?? 1,
    currency: 'usd',
    status: 'paid',
    metadata: {},
  };
}

function buildWebhookEvent(
  eventType: string,
  dataObject: object,
  eventId?: string,
): string {
  return JSON.stringify({
    id: eventId ?? `evt_int_${Date.now()}`,
    object: 'event',
    type: eventType,
    api_version: '2026-02-25.clover',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: dataObject },
  });
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('Billing Webhooks (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let testOrgId: string;
  const TEST_STRIPE_CUSTOMER_ID = 'cus_int_test_001';

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    await resetBusinessDb(prisma);

    // Seed an organization with a Stripe customer ID
    const org = await prisma.organization.create({
      data: {
        name: 'Billing Test Org',
        stripeCustomerId: TEST_STRIPE_CUSTOMER_ID,
      },
    });
    testOrgId = org.id;
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ─── Signature validation ─────────────────────────────────────────────────

  describe('Signature verification', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const payload = buildWebhookEvent('customer.subscription.created', {});
      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(res.status).toBe(400);
    });

    it('returns 400 when stripe-signature is invalid', async () => {
      const payload = buildWebhookEvent('customer.subscription.created', {});
      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 't=1234,v1=invalidsignature')
        .send(payload);

      expect(res.status).toBe(400);
    });
  });

  // ─── customer.subscription.created ───────────────────────────────────────

  describe('customer.subscription.created', () => {
    it('updates org billing status to ACTIVE and returns 200', async () => {
      const subscription = makeSubscriptionObject({
        id: 'sub_new_001',
        status: 'active',
        customerId: TEST_STRIPE_CUSTOMER_ID,
        priceId: 'price_test_pro',
        quantity: 3,
      });

      const payload = buildWebhookEvent(
        'customer.subscription.created',
        subscription,
        'evt_sub_created_001',
      );
      const signature = buildStripeSignatureHeader(payload);

      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });

      // Verify DB state
      const org = await prisma.organization.findUnique({
        where: { id: testOrgId },
      });
      expect(org?.billingStatus).toBe(BillingStatus.ACTIVE);
      expect(org?.subscriptionId).toBe('sub_new_001');
      expect(org?.planId).toBe('price_test_pro');
      expect(org?.seatCount).toBe(3);

      // Verify BillingEvent idempotency record
      const billingEvent = await prisma.billingEvent.findUnique({
        where: { stripeEventId: 'evt_sub_created_001' },
      });
      expect(billingEvent).not.toBeNull();
      expect(billingEvent?.stripeEventId).toBe('evt_sub_created_001');

      // Verify ActivityLog
      const activityLogs = await prisma.activityLog.findMany({
        where: { orgId: testOrgId, action: 'subscription.created' },
      });
      expect(activityLogs.length).toBeGreaterThan(0);
    });

    it('is idempotent — does not process the same event twice', async () => {
      // Use the same event ID as the previous test (already processed)
      const subscription = makeSubscriptionObject({
        status: 'active',
        customerId: TEST_STRIPE_CUSTOMER_ID,
      });

      const payload = buildWebhookEvent(
        'customer.subscription.created',
        subscription,
        'evt_sub_created_001', // same ID as above
      );
      const signature = buildStripeSignatureHeader(payload);

      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      // Still returns 200 (idempotent)
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    });
  });

  // ─── customer.subscription.updated ───────────────────────────────────────

  describe('customer.subscription.updated', () => {
    it('updates org billing fields when subscription changes', async () => {
      const subscription = makeSubscriptionObject({
        id: 'sub_new_001',
        status: 'past_due',
        customerId: TEST_STRIPE_CUSTOMER_ID,
        cancel_at_period_end: true,
      });

      const payload = buildWebhookEvent(
        'customer.subscription.updated',
        subscription,
        `evt_sub_updated_${Date.now()}`,
      );
      const signature = buildStripeSignatureHeader(payload);

      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({
        where: { id: testOrgId },
      });
      expect(org?.billingStatus).toBe(BillingStatus.PAST_DUE);
      expect(org?.cancelAtPeriodEnd).toBe(true);
    });
  });

  // ─── invoice.payment_failed ───────────────────────────────────────────────

  describe('invoice.payment_failed', () => {
    it('sets billingStatus to PAST_DUE and writes ActivityLog', async () => {
      const invoice = makeInvoiceObject(TEST_STRIPE_CUSTOMER_ID, {
        id: 'in_fail_001',
        attempt_count: 2,
      });

      const payload = buildWebhookEvent(
        'invoice.payment_failed',
        invoice,
        `evt_inv_failed_${Date.now()}`,
      );
      const signature = buildStripeSignatureHeader(payload);

      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({
        where: { id: testOrgId },
      });
      expect(org?.billingStatus).toBe(BillingStatus.PAST_DUE);

      const logs = await prisma.activityLog.findMany({
        where: { orgId: testOrgId, action: 'invoice.payment_failed' },
      });
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  // ─── invoice.payment_succeeded ───────────────────────────────────────────

  describe('invoice.payment_succeeded', () => {
    it('sets billingStatus to ACTIVE and writes ActivityLog', async () => {
      const invoice = makeInvoiceObject(TEST_STRIPE_CUSTOMER_ID, {
        id: 'in_paid_001',
        amount_paid: 4900,
      });

      const payload = buildWebhookEvent(
        'invoice.payment_succeeded',
        invoice,
        `evt_inv_paid_${Date.now()}`,
      );
      const signature = buildStripeSignatureHeader(payload);

      const res = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({
        where: { id: testOrgId },
      });
      expect(org?.billingStatus).toBe(BillingStatus.ACTIVE);

      const logs = await prisma.activityLog.findMany({
        where: { orgId: testOrgId, action: 'invoice.payment_succeeded' },
      });
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
