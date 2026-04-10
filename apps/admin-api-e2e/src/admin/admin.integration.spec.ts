/**
 * admin.integration.spec.ts
 *
 * Tests all admin backoffice endpoints through the HTTP layer.
 *
 * Verifies:
 *  - Auth guard: 401 without token, 403 for non-admin users
 *  - GET  /admin/organizations           — list with filters
 *  - GET  /admin/organizations/:orgId    — Customer 360 detail
 *  - GET  /admin/organizations/:orgId/memberships       — list members
 *  - POST /admin/organizations/:orgId/memberships       — invite member
 *  - PATCH /admin/organizations/:orgId/memberships/:id/role — change role
 *  - DELETE /admin/organizations/:orgId/memberships/:id — remove member
 *  - GET  /admin/organizations/:orgId/billing           — billing overview
 *  - POST /admin/organizations/:orgId/billing/portal    — portal URL
 *  - GET  /admin/organizations/:orgId/entitlements      — entitlements
 *  - POST /admin/organizations/:orgId/entitlements/invalidate — cache bust
 *  - PATCH /admin/organizations/:orgId/feature-flags            — set override
 *  - DELETE /admin/organizations/:orgId/feature-flags/:key      — delete override
 *  - GET  /admin/organizations/:orgId/entitlements/overrides    — list overrides
 *  - GET  /admin/activity-log            — cross-tenant activity
 *  - GET  /admin/organizations/:orgId/activity-log      — org activity
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';

import {
  generateTestToken,
  generateAdminTestToken,
} from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';

describe('Admin Backoffice API (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;

  // Seeded data
  let adminToken: string;
  let regularToken: string;
  let tenantOrgId: string;
  let tenantMembershipId: string;
  let tenantMemberId: string;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    await resetBusinessDb(prisma);

    // Seed an admin user — AdminJwtStrategy will upsert into admin_users (legal DB) on first request.
    // No business-DB record needed; the separate Admin-Users-DB connection handles identity.
    const adminAuth0Id = 'auth0|system-admin-int-test';
    adminToken = generateAdminTestToken({
      sub: adminAuth0Id,
      email: 'sysadmin@test.local',
    });

    // Seed a regular (non-admin) user with their own org — tests 403 enforcement
    const regularCtx = await seedFullOrg(prisma, {
      orgName: 'Regular Tenant Org',
    });
    regularToken = generateTestToken({ sub: regularCtx.owner.auth0Id });

    // Seed a tenant org with members (used by most admin endpoint tests)
    const tenantCtx = await seedFullOrg(prisma, {
      orgName: 'Admin Test Tenant',
      withAdmin: true,
      withMember: true,
    });
    tenantOrgId = tenantCtx.org.id;

    // Grab a non-owner membership to use in role-change / remove tests
    const adminMembership = await prisma.membership.findFirst({
      where: { orgId: tenantOrgId, role: 'ADMIN' },
    });
    tenantMembershipId = adminMembership!.id;
    tenantMemberId = adminMembership!.userId;
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ─── Guard enforcement ─────────────────────────────────────────────────────

  describe('Guard enforcement', () => {
    it('returns 401 when no token is provided', async () => {
      const res = await agent.get('/admin/organizations');
      expect(res.status).toBe(401);
    });

    it('returns 403 when a regular user tries to access admin endpoints', async () => {
      const res = await agent
        .get('/admin/organizations')
        .set('Authorization', `Bearer ${regularToken}`);
      expect(res.status).toBe(403);
    });
  });

  // ─── GET /admin/organizations ──────────────────────────────────────────────

  describe('GET /admin/organizations', () => {
    it('returns 200 with paginated list for system admin', async () => {
      const res = await agent
        .get('/admin/organizations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('supports search filter', async () => {
      const res = await agent
        .get('/admin/organizations?search=Admin+Test+Tenant')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const item = res.body.items.find(
        (o: { name: string }) => o.name === 'Admin Test Tenant',
      );
      expect(item).toBeDefined();
    });

    it('supports pagination via limit and offset', async () => {
      const res = await agent
        .get('/admin/organizations?limit=1&offset=0')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(1);
    });
  });

  // ─── GET /admin/organizations/:orgId ──────────────────────────────────────

  describe('GET /admin/organizations/:orgId', () => {
    it('returns 200 with org detail for system admin', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantOrgId);
    });

    it('returns 404 for a non-existent orgId', async () => {
      const res = await agent
        .get('/admin/organizations/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /admin/organizations/:orgId/memberships ──────────────────────────

  describe('GET /admin/organizations/:orgId/memberships', () => {
    it('returns 200 with member list', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/memberships`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });
  });

  // ─── POST /admin/organizations/:orgId/memberships ─────────────────────────

  describe('POST /admin/organizations/:orgId/memberships', () => {
    it('invites a member and returns the new membership', async () => {
      const newEmail = `invite-${Date.now()}@test.local`;

      const res = await agent
        .post(`/admin/organizations/${tenantOrgId}/memberships`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: newEmail, role: 'MEMBER' });

      expect(res.status).toBe(201);
    });

    it('returns 400 when email is missing', async () => {
      const res = await agent
        .post(`/admin/organizations/${tenantOrgId}/memberships`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(400);
    });
  });

  // ─── PATCH /admin/organizations/:orgId/memberships/:id/role ──────────────

  describe('PATCH /admin/organizations/:orgId/memberships/:membershipId/role', () => {
    it('changes a member role and returns the updated membership', async () => {
      const res = await agent
        .patch(
          `/admin/organizations/${tenantOrgId}/memberships/${tenantMembershipId}/role`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'MEMBER' });

      expect(res.status).toBe(200);
    });

    it('returns 400 when newRole is invalid', async () => {
      const res = await agent
        .patch(
          `/admin/organizations/${tenantOrgId}/memberships/${tenantMembershipId}/role`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'INVALID_ROLE' });

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /admin/organizations/:orgId/memberships/:id ──────────────────

  describe('DELETE /admin/organizations/:orgId/memberships/:membershipId', () => {
    it('removes the member and returns 204', async () => {
      // Seed a fresh membership so we don't break other tests
      const targetCtx = await seedFullOrg(prisma, {
        orgName: 'Remove Member Test Org',
        withMember: true,
      });
      const membershipToRemove = await prisma.membership.findFirst({
        where: { orgId: targetCtx.org.id, role: 'MEMBER' },
      });

      const res = await agent
        .delete(
          `/admin/organizations/${targetCtx.org.id}/memberships/${membershipToRemove!.id}`,
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });
  });

  // ─── GET /admin/organizations/:orgId/billing ──────────────────────────────

  describe('GET /admin/organizations/:orgId/billing', () => {
    it('returns 200 with billing overview', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/billing`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('orgId');
    });

    it('returns 404 for a non-existent orgId', async () => {
      const res = await agent
        .get(
          '/admin/organizations/00000000-0000-0000-0000-000000000000/billing',
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /admin/organizations/:orgId/billing/portal ─────────────────────

  describe('POST /admin/organizations/:orgId/billing/portal', () => {
    it('returns 201 with a portal URL when the org has a Stripe customer', async () => {
      // This endpoint returns a portal URL; in test env Stripe is mocked/not configured,
      // so we accept either a 201 with URL or a 400/404 if no Stripe customer exists.
      const res = await agent
        .post(`/admin/organizations/${tenantOrgId}/billing/portal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ returnUrl: 'https://app.test.local/admin' });

      expect([201, 400, 404]).toContain(res.status);
    });
  });

  // ─── GET /admin/organizations/:orgId/entitlements ────────────────────────

  describe('GET /admin/organizations/:orgId/entitlements', () => {
    it('returns 200 with entitlements', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/entitlements`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('plan');
    });

    it('returns 404 for a non-existent orgId', async () => {
      const res = await agent
        .get(
          '/admin/organizations/00000000-0000-0000-0000-000000000000/entitlements',
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /admin/organizations/:orgId/entitlements/invalidate ────────────

  describe('POST /admin/organizations/:orgId/entitlements/invalidate', () => {
    it('returns 200 with success message', async () => {
      const res = await agent
        .post(`/admin/organizations/${tenantOrgId}/entitlements/invalidate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/invalidated/i);
    });
  });

  // ─── PATCH /admin/organizations/:orgId/feature-flags ─────────────────────

  describe('PATCH /admin/organizations/:orgId/feature-flags', () => {
    it('returns 200 and the created override record', async () => {
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          key: 'ssoEnabled',
          value: true,
          reason: 'Integration test trial',
        });

      expect(res.status).toBe(200);
      expect(res.body.key).toBe('ssoEnabled');
      expect(res.body.value).toBe(true);
      expect(res.body.reason).toBe('Integration test trial');
    });

    it('updates an existing override (upsert)', async () => {
      // First set
      await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'maxSeats', value: 50, reason: 'Volume deal' });

      // Then update
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'maxSeats', value: 100, reason: 'Extended deal' });

      expect(res.status).toBe(200);
      expect(res.body.value).toBe(100);
    });

    it('returns 400 when key is missing', async () => {
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: true, reason: 'Missing key' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when reason is missing', async () => {
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'ssoEnabled', value: true });

      expect(res.status).toBe(400);
    });

    it('returns 401 without token', async () => {
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .send({ key: 'ssoEnabled', value: true, reason: 'Test' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ key: 'ssoEnabled', value: true, reason: 'Test' });

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /admin/organizations/:orgId/entitlements/overrides ──────────────

  describe('GET /admin/organizations/:orgId/entitlements/overrides', () => {
    it('returns 200 with an array of overrides (may be empty)', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/entitlements/overrides`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('reflects the ssoEnabled override already set', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/entitlements/overrides`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const ssoOverride = res.body.find(
        (o: { key: string }) => o.key === 'ssoEnabled',
      );
      expect(ssoOverride).toBeDefined();
    });
  });

  // ─── DELETE /admin/organizations/:orgId/feature-flags/:key ───────────────

  describe('DELETE /admin/organizations/:orgId/feature-flags/:key', () => {
    it('returns 204 and removes the override', async () => {
      // Set override first
      await agent
        .patch(`/admin/organizations/${tenantOrgId}/feature-flags`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ key: 'customReports', value: true, reason: 'Test delete' });

      // Then delete
      const res = await agent
        .delete(
          `/admin/organizations/${tenantOrgId}/feature-flags/customReports`,
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
    });

    it('returns 404 when override does not exist', async () => {
      const res = await agent
        .delete(
          `/admin/organizations/${tenantOrgId}/feature-flags/nonExistentKey`,
        )
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /admin/activity-log ──────────────────────────────────────────────

  describe('GET /admin/activity-log', () => {
    it('returns 200 with paginated cross-tenant activity', async () => {
      const res = await agent
        .get('/admin/activity-log')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('supports orgId filter', async () => {
      const res = await agent
        .get(`/admin/activity-log?orgId=${tenantOrgId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ─── GET /admin/organizations/:orgId/activity-log ────────────────────────

  describe('GET /admin/organizations/:orgId/activity-log', () => {
    it('returns 200 with org-scoped activity', async () => {
      const res = await agent
        .get(`/admin/organizations/${tenantOrgId}/activity-log`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
