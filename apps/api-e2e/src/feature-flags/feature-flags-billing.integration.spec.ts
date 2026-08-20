/**
 * feature-flags-billing.integration.spec.ts
 *
 * Integration tests for the cross-module interaction between billing webhooks
 * and the feature-flags entitlements cache.
 *
 * Tests verify the full pipeline:
 *   1. Stripe webhook POST → signature verification → SubscriptionService DB update
 *   2. EventBusService publishes BILLING_SUBSCRIPTION_CANCELLED or SUBSCRIPTION_PLAN_CHANGED
 *   3. LocalTransport (in-process EventEmitter2) fires the event
 *   4. FeatureFlagsService.onModuleInit() event handler invalidates the Redis cache
 *   5. Next GET /organizations/:orgId/entitlements re-reads from DB → returns updated tier
 *
 * This test verifies the handshake between libs/billing and apps/api feature-flags.
 *
 * Prerequisites:
 *   - .env.test:  STRIPE_PRICE_ID_PRO=price_test_pro, STRIPE_PRICE_ID_ENTERPRISE=price_test_enterprise
 *   - STRIPE_WEBHOOK_SECRET=whsec_test_integration_secret_32chars_min
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import Stripe from 'stripe';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { getTestAdminPrisma } from '@test/utils/admin-db.helper';
import { CacheService } from '@libs/redis';
import { BillingStatus } from '@libs/prisma-business';

// ─── Stripe test helpers ──────────────────────────────────────────────────────

const TEST_WEBHOOK_SECRET =
  process.env['STRIPE_WEBHOOK_SECRET'] ??
  'whsec_test_integration_secret_32chars_min';

const PRO_PRICE_ID = process.env['STRIPE_PRICE_ID_PRO'] ?? 'price_test_pro';
const ENTERPRISE_PRICE_ID =
  process.env['STRIPE_PRICE_ID_ENTERPRISE'] ?? 'price_test_enterprise';

/** Stripe SDK instance used only for local test utilities — no real network calls. */
const stripeUtil = new Stripe('sk_test_placeholder_for_integration_tests', {
  apiVersion: '2026-07-29.dahlia',
});

function buildStripeSignatureHeader(payload: string): string {
  return stripeUtil.webhooks.generateTestHeaderString({
    payload,
    secret: TEST_WEBHOOK_SECRET,
  });
}

function buildSubscriptionUpdatedWebhook(opts: {
  customerId: string;
  subscriptionId: string;
  status: Stripe.Subscription.Status;
  priceId: string;
  eventId: string;
}): { payload: string; signature: string } {
  const now = Math.floor(Date.now() / 1000);
  const subscriptionObject = {
    id: opts.subscriptionId,
    object: 'subscription',
    status: opts.status,
    customer: opts.customerId,
    current_period_start: now - 86400,
    current_period_end: now + 86400 * 29,
    cancel_at_period_end: opts.status === 'canceled',
    items: {
      object: 'list',
      data: [
        {
          id: 'si_test_item_001',
          object: 'subscription_item',
          price: { id: opts.priceId, object: 'price' },
          quantity: 5,
          current_period_start: now - 86400,
          current_period_end: now + 86400 * 29,
        },
      ],
    },
    metadata: {},
  };

  const payload = JSON.stringify({
    id: opts.eventId,
    object: 'event',
    type: 'customer.subscription.updated',
    api_version: '2026-07-29.dahlia',
    created: now,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: subscriptionObject },
  });

  return { payload, signature: buildStripeSignatureHeader(payload) };
}

/** Small wait to let in-process async event handlers (EventEmitter2 → cache.del) settle. */
function waitForEventHandlers(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Feature Flags × Billing (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let cache: CacheService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = await getTestAdminPrisma();
    cache = app.get(CacheService);
    await resetBusinessDb(prisma);
    await cache.flushdb();
  });

  afterAll(async () => {
    await cache.flushdb();
    await app.close();
    teardownNockAuth();
  });

  // ─── Subscription cancellation ────────────────────────────────────────────

  describe('Subscription cancellation webhook → FREE tier', () => {
    it('invalidates the entitlements cache when BILLING_SUBSCRIPTION_CANCELLED fires', async () => {
      const STRIPE_CUSTOMER_ID = `cus_ff_cancel_${Date.now()}`;
      const SUBSCRIPTION_ID = `sub_ff_cancel_${Date.now()}`;
      const cacheKey = `entitlements:`;

      // 1. Seed org + owner membership, then configure billing
      const ctx = await seedFullOrg(prisma, { orgName: 'Cancel Test Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
          stripeCustomerId: STRIPE_CUSTOMER_ID,
          subscriptionId: SUBSCRIPTION_ID,
        },
      });

      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgCacheKey = `${cacheKey}${ctx.org.id}`;

      // 2. Warm the cache — GET should return ENTERPRISE
      const warmRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(warmRes.status).toBe(200);
      expect(warmRes.body.plan).toBe('ENTERPRISE');
      expect(await cache.get(orgCacheKey)).not.toBeNull();

      // 3. Send cancellation webhook — billing updates DB + emits BILLING_SUBSCRIPTION_CANCELLED
      const { payload, signature } = buildSubscriptionUpdatedWebhook({
        customerId: STRIPE_CUSTOMER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        status: 'canceled',
        priceId: PRO_PRICE_ID,
        eventId: `evt_ff_cancel_${Date.now()}`,
      });

      const webhookRes = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(webhookRes.status).toBe(200);

      // 4. Verify DB was updated by the billing pipeline
      const updatedOrg = await prisma.organization.findUnique({
        where: { id: ctx.org.id },
      });
      expect(updatedOrg?.billingStatus).toBe(BillingStatus.CANCELED);

      // 5. Allow the async event handler (cache.del) to settle
      await waitForEventHandlers();

      // 6. Cache should now be invalidated
      expect(await cache.get(orgCacheKey)).toBeNull();

      // 7. Next GET forces a fresh DB read → FREE (billingStatus = CANCELED)
      const afterRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(afterRes.status).toBe(200);
      expect(afterRes.body.plan).toBe('FREE');
    });
  });

  // ─── Plan change ──────────────────────────────────────────────────────────

  describe('Plan upgrade webhook → ENTERPRISE tier', () => {
    it('invalidates the cache when SUBSCRIPTION_PLAN_CHANGED fires and returns upgraded tier', async () => {
      const STRIPE_CUSTOMER_ID = `cus_ff_upgrade_${Date.now()}`;
      const SUBSCRIPTION_ID = `sub_ff_upgrade_${Date.now()}`;

      // 1. Seed org with PRO plan (PRO tier)
      const ctx = await seedFullOrg(prisma, { orgName: 'Upgrade Test Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: PRO_PRICE_ID,
          stripeCustomerId: STRIPE_CUSTOMER_ID,
          subscriptionId: SUBSCRIPTION_ID,
        },
      });

      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgCacheKey = `entitlements:${ctx.org.id}`;

      // 2. Warm cache — should return PRO
      const warmRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(warmRes.status).toBe(200);
      expect(warmRes.body.plan).toBe('PRO');
      expect(await cache.get(orgCacheKey)).not.toBeNull();

      // 3. Send plan upgrade webhook — status active, priceId = ENTERPRISE_PRICE_ID
      const { payload, signature } = buildSubscriptionUpdatedWebhook({
        customerId: STRIPE_CUSTOMER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        status: 'active',
        priceId: ENTERPRISE_PRICE_ID,
        eventId: `evt_ff_upgrade_${Date.now()}`,
      });

      const webhookRes = await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      expect(webhookRes.status).toBe(200);

      // 4. Verify DB updated to ENTERPRISE_PRICE_ID
      const updatedOrg = await prisma.organization.findUnique({
        where: { id: ctx.org.id },
      });
      expect(updatedOrg?.planId).toBe(ENTERPRISE_PRICE_ID);

      // 5. Allow async handlers to settle
      await waitForEventHandlers();

      // 6. Cache cleared by SUBSCRIPTION_PLAN_CHANGED handler
      expect(await cache.get(orgCacheKey)).toBeNull();

      // 7. Fresh DB read → now ENTERPRISE
      const afterRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(afterRes.status).toBe(200);
      expect(afterRes.body.plan).toBe('ENTERPRISE');
    });
  });

  // ─── Plan downgrade ───────────────────────────────────────────────────────

  describe('Plan downgrade webhook → PRO tier', () => {
    it('reflects the downgraded tier after cache invalidation', async () => {
      const STRIPE_CUSTOMER_ID = `cus_ff_downgrade_${Date.now()}`;
      const SUBSCRIPTION_ID = `sub_ff_downgrade_${Date.now()}`;

      // 1. Seed org with ENTERPRISE plan (ENTERPRISE tier)
      const ctx = await seedFullOrg(prisma, { orgName: 'Downgrade Test Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
          stripeCustomerId: STRIPE_CUSTOMER_ID,
          subscriptionId: SUBSCRIPTION_ID,
        },
      });

      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgCacheKey = `entitlements:${ctx.org.id}`;

      // 2. Warm cache — should return ENTERPRISE
      const warmRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(warmRes.status).toBe(200);
      expect(warmRes.body.plan).toBe('ENTERPRISE');

      // 3. Send downgrade webhook — status active, priceId = PRO_PRICE_ID
      const { payload, signature } = buildSubscriptionUpdatedWebhook({
        customerId: STRIPE_CUSTOMER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        status: 'active',
        priceId: PRO_PRICE_ID,
        eventId: `evt_ff_downgrade_${Date.now()}`,
      });

      await agent
        .post('/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', signature)
        .send(payload);

      // 4. Allow async cache invalidation to settle
      await waitForEventHandlers();
      expect(await cache.get(orgCacheKey)).toBeNull();

      // 5. Fresh DB read → PRO
      const afterRes = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(afterRes.status).toBe(200);
      expect(afterRes.body.plan).toBe('PRO');
    });
  });
});
