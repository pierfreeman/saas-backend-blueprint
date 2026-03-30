/**
 * auth-flow.integration.spec.ts
 *
 * Validates the full authentication pipeline:
 *   JWT validation (RS256 via nock JWKS) → user sync (upsert) → response
 *
 * Tests:
 *  1. Valid JWT → 200 + user returned
 *  2. First-time user → auto-created in DB
 *  3. Re-login → same user returned (no duplicate)
 *  4. Expired token → 401
 *  5. Missing Authorization header → 401
 *  6. Malformed token → 401
 *
 * Onboarding auto-provisioning:
 *  7. First login creates user + personal org + OWNER membership
 *  8. Re-login does not duplicate org or membership
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import {
  generateTestToken,
  generateExpiredToken,
} from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import {
  BillingStatus,
  MembershipRole,
  MembershipStatus,
} from '@libs/prisma-business';

describe('Auth Flow (integration)', () => {
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

  // ─── Happy path ────────────────────────────────────────────────────────────

  it('GET /auth/me — valid JWT returns 200 with user object', async () => {
    const token = generateTestToken({
      sub: 'auth0|auth-test-001',
      email: 'auth-test-001@test.local',
    });

    const res = await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      auth0Id: 'auth0|auth-test-001',
      email: 'auth-test-001@test.local',
    });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id.length).toBeGreaterThan(0);
  });

  it('GET /auth/me — first-time login creates user in the database', async () => {
    const auth0Id = 'auth0|first-time-login-001';
    const email = 'first-time@test.local';
    const token = generateTestToken({ sub: auth0Id, email });

    // Confirm user does not exist yet
    const before = await prisma.user.findUnique({ where: { auth0Id } });
    expect(before).toBeNull();

    const res = await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // Confirm user was created
    const after = await prisma.user.findUnique({ where: { auth0Id } });
    expect(after).not.toBeNull();
    expect(after?.email).toBe(email);
  });

  it('GET /auth/me — re-login returns the same user (no duplicate)', async () => {
    const auth0Id = 'auth0|repeat-login-001';
    const email = 'repeat@test.local';
    const token = generateTestToken({ sub: auth0Id, email });

    // First request — creates user
    await agent.get('/auth/me').set('Authorization', `Bearer ${token}`);
    // Second request — should not create a second record
    await agent.get('/auth/me').set('Authorization', `Bearer ${token}`);

    const count = await prisma.user.count({ where: { auth0Id } });
    expect(count).toBe(1);
  });

  // ─── Error cases ───────────────────────────────────────────────────────────

  it('GET /auth/me — expired JWT returns 401', async () => {
    const token = generateExpiredToken('auth0|expired-001');

    const res = await agent
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('GET /auth/me — missing Authorization header returns 401', async () => {
    const res = await agent.get('/auth/me');

    expect(res.status).toBe(401);
  });

  it('GET /auth/me — malformed token returns 401', async () => {
    const res = await agent
      .get('/auth/me')
      .set('Authorization', 'Bearer this.is.not.a.valid.jwt');

    expect(res.status).toBe(401);
  });

  // ─── Onboarding auto-provisioning ─────────────────────────────────────────

  describe('User onboarding auto-provisioning', () => {
    it('first login provisions personal org + OWNER membership', async () => {
      const auth0Id = 'auth0|onboarding-new-001';
      const email = 'onboarding-new-001@test.local';
      const token = generateTestToken({ sub: auth0Id, email });

      const res = await agent
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      // user exists
      const user = await prisma.user.findUnique({ where: { auth0Id } });
      expect(user).not.toBeNull();

      // exactly one membership for this user
      const memberships = await prisma.membership.findMany({
        where: { userId: user!.id },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe(MembershipRole.OWNER);
      expect(memberships[0].status).toBe(MembershipStatus.ACTIVE);

      // the linked org is named "Personal Workspace" and starts on the FREE tier
      const org = await prisma.organization.findUnique({
        where: { id: memberships[0].orgId },
      });
      expect(org).not.toBeNull();
      expect(org!.name).toBe('Personal Workspace');
      expect(org!.billingStatus).toBe(BillingStatus.NONE);
    });

    it('re-login does not create duplicate org or membership', async () => {
      const auth0Id = 'auth0|onboarding-repeat-001';
      const email = 'onboarding-repeat-001@test.local';
      const token = generateTestToken({ sub: auth0Id, email });

      // first login — provisions user + org + membership
      await agent.get('/auth/me').set('Authorization', `Bearer ${token}`);
      // second login — should be idempotent
      await agent.get('/auth/me').set('Authorization', `Bearer ${token}`);

      const user = await prisma.user.findUnique({ where: { auth0Id } });
      expect(user).not.toBeNull();

      const membershipCount = await prisma.membership.count({
        where: { userId: user!.id },
      });
      expect(membershipCount).toBe(1);

      const orgCount = await prisma.organization.count({
        where: { memberships: { some: { userId: user!.id } } },
      });
      expect(orgCount).toBe(1);
    });
  });
});
