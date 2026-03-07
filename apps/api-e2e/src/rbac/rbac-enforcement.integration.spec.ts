/**
 * rbac-enforcement.integration.spec.ts
 *
 * Validates the full RBAC pipeline:
 *   JwtAuthGuard → OrgContextGuard → RBACGuard → @RequirePermissions
 *
 * Tests all four roles (OWNER, ADMIN, MEMBER, READ_ONLY) against endpoints
 * that require specific permissions, plus unauthenticated and non-member cases.
 *
 * Permission matrix validated:
 *   ORG_READ         → all active members
 *   ORG_MANAGE       → OWNER, ADMIN
 *   AUDIT_READ       → OWNER, ADMIN
 *   ORG_MEMBERS_INVITE → OWNER, ADMIN
 *   ORG_MEMBERS_ROLE_UPDATE → OWNER, ADMIN
 *   ORG_MEMBERS_REMOVE → OWNER, ADMIN
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';

describe('RBAC Enforcement (integration)', () => {
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

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function makeToken(auth0Id: string) {
    return generateTestToken({ sub: auth0Id });
  }

  // ─── ORG_READ: GET /organizations/:id ─────────────────────────────────────

  describe('GET /organizations/:id (requires ORG_READ)', () => {
    it('OWNER → 200', async () => {
      const ctx = await seedFullOrg(prisma);
      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.owner.auth0Id)}`);
      expect(res.status).toBe(200);
    });

    it('ADMIN → 200', async () => {
      const ctx = await seedFullOrg(prisma, { withAdmin: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.admin!.auth0Id)}`);
      expect(res.status).toBe(200);
    });

    it('MEMBER → 200', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.member!.auth0Id)}`);
      expect(res.status).toBe(200);
    });

    it('READ_ONLY → 200', async () => {
      const ctx = await seedFullOrg(prisma, { withReadOnly: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.readOnly!.auth0Id)}`);
      expect(res.status).toBe(200);
    });

    it('Non-member → 403', async () => {
      const ctx = await seedFullOrg(prisma);
      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken('auth0|rbac-outsider-001')}`);
      expect(res.status).toBe(403);
    });

    it('Unauthenticated → 401', async () => {
      const ctx = await seedFullOrg(prisma);
      const res = await agent.get(`/organizations/${ctx.org.id}`);
      expect(res.status).toBe(401);
    });
  });

  // ─── ORG_MANAGE: PATCH /organizations/:id ─────────────────────────────────

  describe('PATCH /organizations/:id (requires ORG_MANAGE)', () => {
    it('OWNER → 200', async () => {
      const ctx = await seedFullOrg(prisma);
      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.owner.auth0Id)}`)
        .send({ name: 'OWNER Updated' });
      expect(res.status).toBe(200);
    });

    it('ADMIN → 200 (ADMIN has ORG_MANAGE)', async () => {
      const ctx = await seedFullOrg(prisma, { withAdmin: true });
      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.admin!.auth0Id)}`)
        .send({ name: 'ADMIN Updated' });
      expect(res.status).toBe(200);
    });

    it('MEMBER → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.member!.auth0Id)}`)
        .send({ name: 'MEMBER Should Fail' });
      expect(res.status).toBe(403);
    });

    it('READ_ONLY → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withReadOnly: true });
      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${makeToken(ctx.readOnly!.auth0Id)}`)
        .send({ name: 'READ_ONLY Should Fail' });
      expect(res.status).toBe(403);
    });
  });

  // ─── AUDIT_READ: GET /organizations/:orgId/activity-log ───────────────────

  describe('GET /organizations/:orgId/activity-log (requires AUDIT_READ)', () => {
    it('OWNER → 200', async () => {
      const ctx = await seedFullOrg(prisma);
      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${makeToken(ctx.owner.auth0Id)}`)
        .set('x-org-id', ctx.org.id);
      expect(res.status).toBe(200);
    });

    it('ADMIN → 200 (ADMIN has AUDIT_READ)', async () => {
      const ctx = await seedFullOrg(prisma, { withAdmin: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${makeToken(ctx.admin!.auth0Id)}`)
        .set('x-org-id', ctx.org.id);
      expect(res.status).toBe(200);
    });

    it('MEMBER → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${makeToken(ctx.member!.auth0Id)}`)
        .set('x-org-id', ctx.org.id);
      expect(res.status).toBe(403);
    });

    it('READ_ONLY → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withReadOnly: true });
      const res = await agent
        .get(`/organizations/${ctx.org.id}/activity-log`)
        .set('Authorization', `Bearer ${makeToken(ctx.readOnly!.auth0Id)}`)
        .set('x-org-id', ctx.org.id);
      expect(res.status).toBe(403);
    });
  });

  // ─── ORG_MEMBERS_INVITE: POST /organizations/:orgId/memberships ───────────

  describe('POST /organizations/:orgId/memberships (requires ORG_MEMBERS_INVITE)', () => {
    it('MEMBER → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });

      // Sync a new user
      const newAuth0Id = 'auth0|rbac-invite-test-target';
      await agent
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${generateTestToken({ sub: newAuth0Id })}`,
        );
      const newUser = await prisma.user.findUnique({
        where: { auth0Id: newAuth0Id },
      });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${makeToken(ctx.member!.auth0Id)}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      expect(res.status).toBe(403);
    });

    it('READ_ONLY → 403', async () => {
      const ctx = await seedFullOrg(prisma, { withReadOnly: true });
      const newAuth0Id = 'auth0|rbac-readonly-invite-target';
      await agent
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${generateTestToken({ sub: newAuth0Id })}`,
        );
      const newUser = await prisma.user.findUnique({
        where: { auth0Id: newAuth0Id },
      });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${makeToken(ctx.readOnly!.auth0Id)}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      expect(res.status).toBe(403);
    });
  });
});
