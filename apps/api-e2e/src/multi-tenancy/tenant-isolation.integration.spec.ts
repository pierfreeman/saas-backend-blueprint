/**
 * tenant-isolation.integration.spec.ts
 *
 * Validates multi-tenant data isolation at the HTTP layer.
 *
 * Tests:
 *  1. Org A member cannot access Org B via the org route
 *  2. Org A member cannot list Org B memberships
 *  3. Job created in Org A is not visible to Org B members
 *  4. Activity log queries are scoped — Org B cannot see Org A logs
 *  5. Providing a valid token for Org A with Org B's orgId in header → 403
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { JobStatus } from '@libs/prisma-business';

describe('Multi-Tenant Isolation (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ─── Cross-org route access ────────────────────────────────────────────────

  describe('Cross-org route access is forbidden', () => {
    it('Org A owner cannot GET /organizations/:id for Org B', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Tenant Isolation Org A',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Tenant Isolation Org B',
      });

      const orgAOwnerToken = generateTestToken({ sub: ctxA.owner.auth0Id });

      // Org A token, Org B route path → OrgContextGuard reads :id as orgId → no membership in Org B → 403
      const res = await agent
        .get(`/organizations/${ctxB.org.id}`)
        .set('Authorization', `Bearer ${orgAOwnerToken}`);

      expect(res.status).toBe(403);
    });

    it('Org A owner cannot list Org B memberships', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Tenant ISO Org A-Mem',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Tenant ISO Org B-Mem',
      });

      const orgAOwnerToken = generateTestToken({ sub: ctxA.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctxB.org.id}/memberships`)
        .set('Authorization', `Bearer ${orgAOwnerToken}`)
        .set('x-org-id', ctxB.org.id);

      expect(res.status).toBe(403);
    });

    it('x-org-id header for Org B with Org A token → 403', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Tenant ISO Header A',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Tenant ISO Header B',
      });

      const orgAOwnerToken = generateTestToken({ sub: ctxA.owner.auth0Id });

      // Explicitly send x-org-id for Org B while authenticated as Org A owner
      const res = await agent
        .get(`/organizations/${ctxB.org.id}/activity-log`)
        .set('Authorization', `Bearer ${orgAOwnerToken}`)
        .set('x-org-id', ctxB.org.id);

      expect(res.status).toBe(403);
    });
  });

  // ─── Data isolation in query results ──────────────────────────────────────

  describe('Data isolation in query results', () => {
    it('GET /organizations returns only orgs the caller belongs to', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Isolation List Org A',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Isolation List Org B',
      });

      const orgAOwnerToken = generateTestToken({ sub: ctxA.owner.auth0Id });

      const res = await agent
        .get('/organizations')
        .set('Authorization', `Bearer ${orgAOwnerToken}`);

      expect(res.status).toBe(200);
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.organizations ?? res.body.data ?? []);
      const orgIds = list.map((o: { id: string }) => o.id);

      // Org A is in the list
      expect(orgIds).toContain(ctxA.org.id);
      // Org B is NOT in the list (caller has no membership there)
      expect(orgIds).not.toContain(ctxB.org.id);
    });

    it('Job created in Org A is not accessible with Org B tenant context', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Job Isolation Org A',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Job Isolation Org B',
      });

      // Create a job in Org A
      const orgAOwnerUser = await prisma.user.findUnique({
        where: { auth0Id: ctxA.owner.auth0Id },
      });
      const job = await prisma.job.create({
        data: {
          orgId: ctxA.org.id,
          userId: orgAOwnerUser!.id,
          type: 'heavy_job',
          status: JobStatus.DONE,
          payload: {},
        },
      });

      // Org B owner tries to access Org A's job with Org B context
      const orgBOwnerToken = generateTestToken({ sub: ctxB.owner.auth0Id });

      const res = await agent
        .get(`/tasks/${job.id}`)
        .set('Authorization', `Bearer ${orgBOwnerToken}`)
        .set('x-org-id', ctxB.org.id);

      // The job belongs to Org A — should not be visible in Org B context
      expect(res.status).toBe(404);
    });

    it('Activity logs from Org A are not visible to Org B', async () => {
      const ctxA = await seedFullOrg(prisma, {
        orgName: 'Log Isolation Org A',
      });
      const ctxB = await seedFullOrg(prisma, {
        orgName: 'Log Isolation Org B',
        withAdmin: true,
      });

      // Seed activity log in Org A
      const orgAOwnerUser = await prisma.user.findUnique({
        where: { auth0Id: ctxA.owner.auth0Id },
      });
      await prisma.activityLog.create({
        data: {
          orgId: ctxA.org.id,
          actorId: orgAOwnerUser!.id,
          action: 'test.isolation.event',
          actorRole: 'OWNER',
        },
      });

      // Org B admin (has AUDIT_READ) queries their own activity log
      const orgBAdminToken = generateTestToken({ sub: ctxB.admin!.auth0Id });

      const res = await agent
        .get(`/organizations/${ctxB.org.id}/activity-log`)
        .set('Authorization', `Bearer ${orgBAdminToken}`)
        .set('x-org-id', ctxB.org.id);

      expect(res.status).toBe(200);
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.logs ?? res.body.data ?? []);

      // None of the returned logs should belong to Org A
      const orgALogs = list.filter(
        (l: { orgId: string }) => l.orgId === ctxA.org.id,
      );
      expect(orgALogs.length).toBe(0);
    });
  });
});
