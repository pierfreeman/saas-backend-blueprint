/**
 * org-crud.integration.spec.ts
 *
 * Tests organization CRUD operations through the HTTP layer.
 *
 * Verifies:
 *  - POST /organizations creates org + OWNER membership
 *  - GET /organizations returns only the caller's orgs
 *  - GET /organizations/:id enforces ORG_READ permission
 *  - PATCH /organizations/:id enforces ORG_MANAGE permission
 *  - 404 when accessing a non-existent or foreign org
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';

describe('Organization CRUD (integration)', () => {
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

  // ─── POST /organizations ───────────────────────────────────────────────────

  describe('POST /organizations', () => {
    it('creates an organization and returns 201 with org body', async () => {
      const token = generateTestToken({ sub: 'auth0|org-create-001' });
      const orgName = 'Integration Test Org Alpha';

      const res = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: orgName });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: orgName });
      expect(typeof res.body.id).toBe('string');
    });

    it('auto-creates the caller as OWNER in the new organization', async () => {
      const auth0Id = 'auth0|org-create-owner-check';
      const token = generateTestToken({ sub: auth0Id });

      const res = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Owner Check Org' });

      expect(res.status).toBe(201);
      const orgId = res.body.id;

      const user = await prisma.user.findUnique({ where: { auth0Id } });
      expect(user).not.toBeNull();

      const membership = await prisma.membership.findFirst({
        where: { orgId, userId: user!.id },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe('OWNER');
      expect(membership?.status).toBe('ACTIVE');
    });

    it('returns 400 when name is missing', async () => {
      const token = generateTestToken({ sub: 'auth0|org-create-noname' });

      const res = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 401 without a token', async () => {
      const res = await agent
        .post('/organizations')
        .send({ name: 'Should Fail' });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /organizations ────────────────────────────────────────────────────

  describe('GET /organizations', () => {
    it('returns only orgs the caller is a member of', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'User Org A' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get('/organizations')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // The response may be an array or a paginated object — assert presence
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.organizations ?? res.body.data);
      expect(Array.isArray(list)).toBe(true);

      const orgIds = list.map((o: { id: string }) => o.id);
      expect(orgIds).toContain(ctx.org.id);
    });

    it('does not return orgs for which the caller has no membership', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Foreign Org' });
      const otherToken = generateTestToken({ sub: 'auth0|org-list-outsider' });

      const res = await agent
        .get('/organizations')
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(200);
      const list = Array.isArray(res.body)
        ? res.body
        : (res.body.organizations ?? res.body.data ?? []);
      const orgIds = list.map((o: { id: string }) => o.id);
      expect(orgIds).not.toContain(ctx.org.id);
    });
  });

  // ─── GET /organizations/:id ────────────────────────────────────────────────

  describe('GET /organizations/:id', () => {
    it('returns the org for a member with ORG_READ permission', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const token = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: ctx.org.id, name: ctx.org.name });
    });

    it('returns 403 for a non-member', async () => {
      const ctx = await seedFullOrg(prisma);
      const outsiderToken = generateTestToken({ sub: 'auth0|outsider-001' });

      const res = await agent
        .get(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 404 for a non-existent org id', async () => {
      const token = generateTestToken({ sub: 'auth0|org-get-404' });
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const res = await agent
        .get(`/organizations/${fakeId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── PATCH /organizations/:id ──────────────────────────────────────────────

  describe('PATCH /organizations/:id', () => {
    it('allows OWNER to update the org name', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const newName = 'Updated Org Name';

      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: newName });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ name: newName });
    });

    it('returns 403 when MEMBER tries to update the org', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const token = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .patch(`/organizations/${ctx.org.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Should Not Update' });

      expect(res.status).toBe(403);
    });
  });
});
