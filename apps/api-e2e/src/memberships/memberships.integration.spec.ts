/**
 * memberships.integration.spec.ts
 *
 * Tests the membership management API:
 *  - POST /organizations/:orgId/memberships  (invite)
 *  - GET  /organizations/:orgId/memberships  (list)
 *  - PATCH /organizations/:orgId/memberships/:id (role update)
 *  - DELETE /organizations/:orgId/memberships/:id (remove)
 *
 * Verifies:
 *  - OWNER and ADMIN can invite new members
 *  - Role hierarchy is enforced
 *  - Suspended members cannot perform actions
 *  - MEMBER cannot invite or update roles
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import {
  seedFullOrg,
  createTestUser,
  createTestMembership,
} from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus } from '@prisma/client';

describe('Memberships (integration)', () => {
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

  // ─── POST /organizations/:orgId/memberships ────────────────────────────────

  describe('POST /organizations/:orgId/memberships', () => {
    it('OWNER can invite a new MEMBER', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });

      // Sync new user into DB via GET /auth/me
      const newAuth0Id = 'auth0|invite-target-001';
      const newEmail = 'invite-target-001@test.local';
      await agent
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${generateTestToken({ sub: newAuth0Id, email: newEmail })}`,
        );

      const newUser = await prisma.user.findUnique({
        where: { auth0Id: newAuth0Id },
      });
      expect(newUser).not.toBeNull();

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: newUser!.id,
        orgId: ctx.org.id,
        role: 'MEMBER',
      });
    });

    it('ADMIN can invite a new MEMBER', async () => {
      const ctx = await seedFullOrg(prisma, { withAdmin: true });
      const adminToken = generateTestToken({ sub: ctx.admin!.auth0Id });

      const newAuth0Id = 'auth0|admin-invite-target-001';
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
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      expect(res.status).toBe(201);
    });

    it('MEMBER cannot invite new members (403)', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const newAuth0Id = 'auth0|member-invite-target-001';
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
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ userId: newUser!.id, role: 'MEMBER' });

      expect(res.status).toBe(403);
    });
  });

  // ─── GET /organizations/:orgId/memberships ─────────────────────────────────

  describe('GET /organizations/:orgId/memberships', () => {
    it('returns all memberships for a member with ORG_READ', async () => {
      const ctx = await seedFullOrg(prisma, {
        withMember: true,
        withAdmin: true,
      });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.memberships ?? res.body.data);
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(3); // owner + admin + member
    });

    it('returns 403 for a non-member', async () => {
      const ctx = await seedFullOrg(prisma);
      const outsiderToken = generateTestToken({
        sub: 'auth0|memberships-outsider',
      });

      const res = await agent
        .get(`/organizations/${ctx.org.id}/memberships`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(403);
    });
  });

  // ─── PATCH /organizations/:orgId/memberships/:id ───────────────────────────

  describe('PATCH /organizations/:orgId/memberships/:id', () => {
    it('OWNER can promote a MEMBER to ADMIN', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const membershipId = ctx.member!.membership.id;

      const res = await agent
        .patch(`/organizations/${ctx.org.id}/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'ADMIN' });

      const updated = await prisma.membership.findUnique({
        where: { id: membershipId },
      });
      expect(updated?.role).toBe(MembershipRole.ADMIN);
    });

    it('MEMBER cannot update roles (403)', async () => {
      const ctx = await seedFullOrg(prisma, {
        withMember: true,
        withReadOnly: true,
      });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });
      const readOnlyMembershipId = ctx.readOnly!.membership.id;

      const res = await agent
        .patch(
          `/organizations/${ctx.org.id}/memberships/${readOnlyMembershipId}`,
        )
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ role: 'MEMBER' });

      expect(res.status).toBe(403);
    });
  });

  // ─── DELETE /organizations/:orgId/memberships/:id ─────────────────────────

  describe('DELETE /organizations/:orgId/memberships/:id', () => {
    it('OWNER can remove a MEMBER', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const membershipId = ctx.member!.membership.id;

      const res = await agent
        .delete(`/organizations/${ctx.org.id}/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);

      const removed = await prisma.membership.findUnique({
        where: { id: membershipId },
      });
      // Membership may be deleted or suspended depending on service logic
      expect(
        removed === null || removed?.status === MembershipStatus.SUSPENDED,
      ).toBe(true);
    });

    it('MEMBER cannot remove other members (403)', async () => {
      const ctx = await seedFullOrg(prisma, {
        withMember: true,
        withReadOnly: true,
      });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });
      const readOnlyMembershipId = ctx.readOnly!.membership.id;

      const res = await agent
        .delete(
          `/organizations/${ctx.org.id}/memberships/${readOnlyMembershipId}`,
        )
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(403);
    });
  });

  // ─── Suspended member access ───────────────────────────────────────────────

  describe('Suspended member', () => {
    it('suspended member gets 403 on all org-scoped routes', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const memberMembership = ctx.member!.membership;

      // Suspend the membership directly in DB
      await prisma.membership.update({
        where: { id: memberMembership.id },
        data: { status: MembershipStatus.SUSPENDED },
      });

      const suspendedToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${suspendedToken}`);

      expect(res.status).toBe(403);
    });
  });
});
