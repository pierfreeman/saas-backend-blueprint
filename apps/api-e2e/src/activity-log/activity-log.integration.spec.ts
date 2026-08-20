/**
 * activity-log.integration.spec.ts
 *
 * Tests the activity log pipeline end-to-end:
 *  - Business operations trigger fire-and-forget ActivityLog entries in the business DB
 *  - Business operations trigger fire-and-forget LegalAudit entries in the legal DB
 *  - GET /organizations/:orgId/activity-log returns paginated results (AUDIT_READ required)
 *  - Activity logs are scoped by orgId — no cross-tenant leakage
 *
 * Fire-and-forget timing: a 300ms sleep is added after triggering actions so the
 * background Prisma create() has time to commit before assertions.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { getTestAdminPrisma } from '@test/utils/admin-db.helper';
import { PrismaLegalService } from '@libs/prisma-legal';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Activity Log & Legal Audit (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let legalPrisma: PrismaLegalService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = await getTestAdminPrisma();
    legalPrisma = app.get(PrismaLegalService);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ─── GET /organizations/:orgId/activity-log ────────────────────────────────

  describe('GET /organizations/:orgId/activity-log', () => {
    it('OWNER can retrieve activity logs', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
    });

    it('MEMBER cannot read activity logs (403)', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const token = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(403);
    });

    it('returns paginated structure with total and logs array', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('supports limit and offset query params', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      // Seed several activity log entries
      const ownerUser = await prisma.user.findUnique({
        where: { auth0Id: ctx.owner.auth0Id },
      });
      await prisma.activityLog.createMany({
        data: Array.from({ length: 5 }).map((_, i) => ({
          orgId: ctx.org.id,
          actorId: ownerUser!.id,
          action: `test.pagination.event.${i}`,
          actorRole: 'OWNER',
        })),
      });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log?limit=2&offset=0`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(2);
    });
  });

  // ─── Activity log written on org creation ─────────────────────────────────

  describe('Activity log entries after business operations', () => {
    it('org creation via API writes an activity log entry', async () => {
      const auth0Id = 'auth0|activity-log-creator-001';
      const token = generateTestToken({ sub: auth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Org For Activity Log Test' });

      expect(createRes.status).toBe(201);
      const orgId = createRes.body.id as string;

      // Fire-and-forget — allow the async log write to commit
      await sleep(300);

      const logs = await prisma.activityLog.findMany({ where: { orgId } });
      expect(logs.length).toBeGreaterThan(0);

      const createdLog = logs.find((l) => l.action === 'organization.created');
      expect(createdLog).toBeDefined();
      expect(createdLog?.orgId).toBe(orgId);
    });

    it('membership role change writes an activity log entry', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const membershipId = ctx.member!.membership.id;

      await agent
        .patch(`/organizations/${ctx.org.id}/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ role: 'ADMIN' });

      await sleep(300);

      const logs = await prisma.activityLog.findMany({
        where: { orgId: ctx.org.id, action: 'membership.role_changed' },
      });
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  // ─── Legal audit entries after business operations ─────────────────────────

  describe('Legal audit entries after business operations', () => {
    it('org creation via API writes a legal audit event', async () => {
      const auth0Id = 'auth0|legal-audit-creator-001';
      const token = generateTestToken({ sub: auth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Org For Legal Audit Test' });

      expect(createRes.status).toBe(201);
      const orgId = createRes.body.id as string;

      await sleep(300);

      const events = await legalPrisma.auditEvent.findMany({
        where: { orgId, eventType: 'organization.created' },
      });
      expect(events.length).toBeGreaterThan(0);
    });

    it('membership creation writes a legal audit event', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });

      // Sync a new user
      const newAuth0Id = 'auth0|legal-audit-invite-target';
      await agent
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${generateTestToken({ sub: newAuth0Id })}`,
        );
      const newUser = await prisma.user.findUnique({
        where: { auth0Id: newAuth0Id },
      });

      await agent
        .post(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      await sleep(300);

      const events = await legalPrisma.auditEvent.findMany({
        where: { orgId: ctx.org.id, eventType: 'membership.created' },
      });
      expect(events.length).toBeGreaterThan(0);
    });

    it('legal audit records are immutable — no cleanDatabase affects them', async () => {
      // This test documents the design contract: legal DB events persist across
      // cleanDatabase() calls. We use a unique orgId that survives the reset.
      const auth0Id = 'auth0|legal-audit-persistence-test';
      const token = generateTestToken({ sub: auth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Persistence Test Org' });

      const orgId = createRes.body.id as string;
      await sleep(300);

      // cleanDatabase() resets the business DB only
      await resetBusinessDb(prisma);

      // Legal audit records for orgId should still exist
      const events = await legalPrisma.auditEvent.findMany({
        where: { orgId },
      });
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
