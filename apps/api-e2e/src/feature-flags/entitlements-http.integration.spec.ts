/**
 * entitlements-http.integration.spec.ts
 *
 * Integration tests for the Feature Flags HTTP layer.
 *
 * Tests verify the full request pipeline:
 *   1. GET  /organizations/:orgId/entitlements   – entitlement resolution from DB
 *   2. POST /organizations/:orgId/entitlements/invalidate – cache invalidation
 *   3. Redis cache hit / miss behaviour across consecutive requests
 *   4. Auth and membership enforcement (401 / 403)
 *
 * Plan tier resolution (from .env.test):
 *   - STRIPE_PRICE_ID_PRO   = price_test_pro   → PRO tier
 *   - STRIPE_PRICE_ID_ENTERPRISE = price_test_enterprise  → ENTERPRISE tier
 *   - anything else / billingStatus ≠ ACTIVE    → FREE tier
 *
 * Prerequisites (handled by globalSetup):
 *   - PostgreSQL and Redis test containers running
 *   - Prisma migrations applied
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { BillingStatus } from '@libs/prisma-business';

const PRO_PRICE_ID = process.env['STRIPE_PRICE_ID_PRO'] ?? 'price_test_pro';
const ENTERPRISE_PRICE_ID =
  process.env['STRIPE_PRICE_ID_ENTERPRISE'] ?? 'price_test_enterprise';

describe('Feature Flags – Entitlements HTTP (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let cache: CacheService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    cache = app.get(CacheService);
    await resetBusinessDb(prisma);
    await cache.flushdb();
  });

  afterAll(async () => {
    await cache.flushdb();
    await app.close();
    teardownNockAuth();
  });

  // ─── Plan tier resolution ──────────────────────────────────────────────────

  describe('GET /organizations/:orgId/entitlements', () => {
    it('returns FREE tier for an org with billingStatus NONE (no subscription)', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Free Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('FREE');
      expect(res.body.organizationId).toBe(ctx.org.id);
      expect(res.body.advancedAnalytics).toBe(false);
      expect(res.body.apiAccess).toBe(false);
      expect(res.body.ssoEnabled).toBe(false);
    });

    it('returns ENTERPRISE tier for an org with ACTIVE status and ENTERPRISE price ID', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Enterprise Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('ENTERPRISE');
      expect(res.body.advancedAnalytics).toBe(true);
      expect(res.body.ssoEnabled).toBe(true);
      expect(res.body.prioritySupport).toBe(true);
    });

    it('returns PRO tier for an org with ACTIVE status and PRO price ID', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Pro Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: PRO_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('PRO');
      expect(res.body.advancedAnalytics).toBe(true);
      expect(res.body.ssoEnabled).toBe(false);
      expect(res.body.prioritySupport).toBe(false);
    });

    it('returns FREE tier when billingStatus is PAST_DUE despite a paid planId', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'PastDue Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.PAST_DUE,
          planId: PRO_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('FREE');
    });

    it('returns FREE tier when billingStatus is CANCELED', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Canceled Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.CANCELED,
          planId: PRO_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('FREE');
    });

    // ─── Auth enforcement ──────────────────────────────────────────────────

    it('returns 401 when no Authorization header is provided', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Auth Guard Org' });

      const res = await agent.get(`/organizations/${ctx.org.id}/entitlements`);

      expect(res.status).toBe(401);
    });

    it('returns 403 when the user has no membership in the org', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Outsider Org' });
      const outsiderToken = generateTestToken({
        sub: 'auth0|feature-flags-outsider-001',
      });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(403);
    });
  });

  // ─── Redis cache behaviour ─────────────────────────────────────────────────

  describe('Redis cache hit/miss', () => {
    it('populates the Redis cache after the first entitlements request', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Cache Miss Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Verify nothing cached before the first request
      const before = await cache.get(cacheKey);
      expect(before).toBeNull();

      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      const after = await cache.get<{ plan: string }>(cacheKey);
      expect(after).not.toBeNull();
      expect((after as { plan: string }).plan).toBe('FREE');
    });

    it('serves subsequent requests from Redis (cache entry has a positive TTL)', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Cache TTL Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // First request — cold
      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      const ttlAfterFirst = await cache.ttl(cacheKey);
      expect(ttlAfterFirst).toBeGreaterThan(0);

      // Second request — should still be cached
      const res = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      const ttlAfterSecond = await cache.ttl(cacheKey);
      expect(ttlAfterSecond).toBeGreaterThan(0);
    });
  });

  // ─── Cache invalidation endpoint ──────────────────────────────────────────

  describe('POST /organizations/:orgId/entitlements/invalidate', () => {
    it('returns 200 with a confirmation message', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Invalidate Org A' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain(ctx.org.id);
    });

    it('removes the Redis cache entry', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Invalidate Org B' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const cacheKey = `entitlements:${ctx.org.id}`;

      // Warm the cache first
      await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).not.toBeNull();

      // Invalidate
      await agent
        .post(`/organizations/${ctx.org.id}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(await cache.get(cacheKey)).toBeNull();
    });

    it('forces a fresh DB read with updated tier after invalidation', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Invalidate Org C' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      // Initial read: FREE
      const first = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(first.body.plan).toBe('FREE');

      // Upgrade billing in DB while the old value is still cached
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
        },
      });

      // Without invalidation, cached FREE still returned
      const cached = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(cached.body.plan).toBe('FREE');

      // Invalidate then re-read → fresh DB value
      await agent
        .post(`/organizations/${ctx.org.id}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      const fresh = await agent
        .get(`/organizations/${ctx.org.id}/entitlements`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(fresh.status).toBe(200);
      expect(fresh.body.plan).toBe('ENTERPRISE');
    });
  });
});
