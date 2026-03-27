/**
 * feature-flags-cache.integration.spec.ts
 *
 * Integration tests for Feature Flags Redis cache behavior.
 *
 * All cache inspection is done via CacheService (app.get(CacheService)) directly.
 * Entitlement reads go through the HTTP layer so the full middleware/guard stack
 * is exercised. Event-driven invalidation is tested by emitting events via
 * LocalTransport (app.get(LocalTransport)) and observing Redis state.
 *
 * Scenarios:
 *   1. Cold miss  — first HTTP GET populates the Redis cache
 *   2. Cache hit  — cache key remains after second GET (TTL intact)
 *   3. Stale-cache isolation — DB changes while hot cache return old tier
 *   4. Manual invalidation via POST endpoint removes the cache key
 *   5. Event-driven invalidation — LocalTransport.send() fires SUBSCRIPTION_PLAN_CHANGED
 *      → FeatureFlagsService async handler calls cache.del() → cache cleared
 *   6. Event without orgId does NOT clear unrelated cache entries
 *
 * Uses real Redis (port 6380, from docker-compose.test.yml).
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { LocalTransport, DOMAIN_EVENTS } from '@libs/events';
import { BillingStatus } from '@prisma/client';

const PRO_PRICE_ID = process.env['STRIPE_PRICE_ID_PRO'] ?? 'price_test_pro';
const ENTERPRISE_PRICE_ID =
  process.env['STRIPE_PRICE_ID_ENTERPRISE'] ?? 'price_test_enterprise';

/** Flush any pending Promises and allow in-process Redis operations to complete. */
function waitForEventHandlers(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 100));
}

describe('FeatureFlagsService – Redis cache (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let cache: CacheService;
  let localTransport: LocalTransport;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    cache = app.get(CacheService);
    localTransport = app.get(LocalTransport);
    await resetBusinessDb(prisma);
    await cache.flushdb();
  });

  afterAll(async () => {
    await cache.flushdb();
    await app.close();
    teardownNockAuth();
  });

  // ─── Cache miss and population ────────────────────────────────────────────

  describe('Cache-miss path', () => {
    it('HTTP GET populates the Redis cache on first request', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Cache Miss Org A' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Nothing in cache before the first request
      expect(await cache.get(cacheKey)).toBeNull();

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('FREE');

      // Redis should now hold the value
      const cached = await cache.get<{ plan: string }>(cacheKey);
      expect(cached).not.toBeNull();
      expect((cached as { plan: string }).plan).toBe('FREE');
    });

    it('cache entry has a positive TTL after first population', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Cache TTL Org A' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      const ttl = await cache.ttl(cacheKey);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  // ─── Cache hit ────────────────────────────────────────────────────────────

  describe('Cache-hit path (stale cache)', () => {
    it('returns the cached value even after the DB record is upgraded', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Stale Cache Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      // Warm cache — FREE
      const first = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(first.body.plan).toBe('FREE');

      // Upgrade the org in DB without invalidating the cache
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: PRO_PRICE_ID,
        },
      });

      // Second GET — cache warm, still returns FREE (stale)
      const second = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(second.body.plan).toBe('FREE');
    });
  });

  // ─── Manual invalidation ──────────────────────────────────────────────────

  describe('Manual invalidation via POST /invalidate', () => {
    it('POST /invalidate removes the Redis cache entry', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Manual Invalidate Org A',
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Warm cache
      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).not.toBeNull();

      // Invalidate via HTTP
      await agent
        .post(`/organizations/${ctx.org.id}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).toBeNull();
    });

    it('forces a DB re-read with the updated tier after invalidation', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Manual Invalidate Org B',
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      // Cold read — FREE
      const first = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(first.body.plan).toBe('FREE');

      // Upgrade DB while cache is warm
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
        },
      });

      // Invalidate via HTTP → next GET re-reads DB
      await agent
        .post(`/organizations/${ctx.org.id}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      const second = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(second.status).toBe(200);
      expect(second.body.plan).toBe('ENTERPRISE');
    });
  });

  // ─── Event-driven invalidation ────────────────────────────────────────────

  describe('LocalTransport event-driven invalidation', () => {
    it('SUBSCRIPTION_PLAN_CHANGED event clears the cache key', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Event Invalidate Org A',
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Warm cache via HTTP GET
      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).not.toBeNull();

      // Emit the domain event directly via LocalTransport (as billing lib would)
      await localTransport.send({
        eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        timestamp: new Date(),
        payload: {
          orgId: ctx.org.id,
          subscriptionId: 'sub_test',
          status: 'active',
        },
        tenantId: ctx.org.id,
      });

      // Allow the async handler (cache.del) to resolve
      await waitForEventHandlers();

      // Cache should be cleared
      expect(await cache.get(cacheKey)).toBeNull();
    });

    it('BILLING_SUBSCRIPTION_CANCELLED event clears the cache key', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Event Invalidate Org B',
      });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Warm cache — ENTERPRISE tier
      const warm = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(warm.body.plan).toBe('ENTERPRISE');
      expect(await cache.get(cacheKey)).not.toBeNull();

      // Emit cancellation event
      await localTransport.send({
        eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
        timestamp: new Date(),
        payload: {
          orgId: ctx.org.id,
          subscriptionId: 'sub_test',
          status: 'canceled',
        },
        tenantId: ctx.org.id,
      });

      await waitForEventHandlers();

      // Cache cleared
      expect(await cache.get(cacheKey)).toBeNull();
    });

    it('event without orgId in payload does NOT clear unrelated cache entries', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Event No OrgId Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Warm cache
      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).not.toBeNull();

      // Emit event without orgId — the handler should be a no-op
      await localTransport.send({
        eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        timestamp: new Date(),
        payload: { subscriptionId: 'sub_no_org' }, // no orgId field
        tenantId: undefined,
      });

      await waitForEventHandlers();

      // Cache for this org should remain intact
      expect(await cache.get(cacheKey)).not.toBeNull();
    });
  });
});
