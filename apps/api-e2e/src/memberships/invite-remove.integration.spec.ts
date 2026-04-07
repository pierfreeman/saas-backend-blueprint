/**
 * invite-remove.integration.spec.ts
 *
 * Integration tests for the email-based invite flow and the remove-member flow:
 *
 * POST /organizations/:orgId/memberships/invite  (InviteMemberService)
 *   - Creates a pending Prisma record for unknown emails
 *   - Reuses the existing user record when the email is already in Prisma
 *   - Calls Auth0 POST /passwordless/start with the correct payload
 *   - Returns 409 on duplicate membership, 403 without permission, 400 on bad email
 *
 * Pending → real auth0Id linking on first login (AuthService.syncUser)
 *   - The pending:uuid placeholder is replaced by the real Auth0 sub
 *   - The membership is preserved after the link
 *
 * DELETE /organizations/:orgId/memberships/:id  (RemoveMemberService)
 *   - Last-org removal: deletes membership + Prisma user + Auth0 account
 *   - Pending-only user (never logged in): skips Auth0 delete, cleans Prisma record
 *   - Multi-org user: preserves Prisma record and Auth0 account
 *
 * Auth0 Management calls (sendInviteLink, deleteUser) are verified via
 * vi.spyOn — the Auth0 domain in .env.test (test.auth0.local) is unreachable
 * in CI. JWKS for JWT verification is intercepted by the nock-auth helper.
 */
import * as crypto from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import {
  seedFullOrg,
  createTestUser,
  createTestMembership,
} from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole } from '@libs/prisma-business';
import { IIdentityProvider } from '@libs/common';

/** Unique suffix to avoid collisions between tests. */
function uid(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** FRONTEND_BASE_URL is not set in .env.test → service falls back to this. */
const EXPECTED_REDIRECT_URI = 'http://localhost:4200/auth/callback';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Invite & Remove Member (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let auth0Service: IIdentityProvider;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    auth0Service = app.get(IIdentityProvider);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ─── POST /organizations/:orgId/memberships/invite ──────────────────────────

  describe('POST /organizations/:orgId/memberships/invite', () => {
    it('OWNER invites a brand-new email — creates a pending Prisma record and sends the magic link', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const email = `new-user-${uid()}@test.local`;

      // AUTH0_SPA_CLIENT_ID is set in .env.test; AUTH0_M2M_CLIENT_ID is empty.
      // Spy verifies the service called sendInviteLink with the right args.
      // The unit tests for Auth0ManagementService cover the actual HTTP payload.
      const passwordlessSpy = vi
        .spyOn(auth0Service, 'sendInviteLink')
        .mockResolvedValue(undefined);

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email, role: 'MEMBER' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        message: 'Invitation sent successfully.',
      });

      // Auth0: sendInviteLink was called with correct email and redirect URI
      expect(passwordlessSpy).toHaveBeenCalledWith(
        email,
        EXPECTED_REDIRECT_URI,
      );
      passwordlessSpy.mockRestore();

      // Prisma: pending user created
      const user = await prisma.user.findFirst({ where: { email } });
      expect(user).not.toBeNull();
      expect(user!.auth0Id).toMatch(/^pending:/);

      // Prisma: membership created (Prisma schema default status is ACTIVE)
      const membership = await prisma.membership.findFirst({
        where: { userId: user!.id, orgId: ctx.org.id },
      });
      expect(membership).not.toBeNull();
    });

    it('OWNER invites an existing Prisma user — reuses their record, no new user created', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const existingUser = await createTestUser(prisma, {
        auth0Id: `auth0|existing-${uid()}`,
        email: `existing-${uid()}@test.local`,
      });

      const passwordlessSpy = vi
        .spyOn(auth0Service, 'sendInviteLink')
        .mockResolvedValue(undefined);

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email: existingUser.email, role: 'MEMBER' });

      expect(res.status).toBe(201);

      // sendInviteLink called with the existing user's email
      expect(passwordlessSpy).toHaveBeenCalledWith(
        existingUser.email,
        EXPECTED_REDIRECT_URI,
      );
      passwordlessSpy.mockRestore();

      // No duplicate user created
      const count = await prisma.user.count({
        where: { email: existingUser.email },
      });
      expect(count).toBe(1);

      // Membership links to the pre-existing user
      const membership = await prisma.membership.findFirst({
        where: { userId: existingUser.id, orgId: ctx.org.id },
      });
      expect(membership).not.toBeNull();
    });

    it('returns 409 when the user is already a member of the organization', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email: ctx.member!.user.email, role: 'MEMBER' });

      expect(res.status).toBe(409);
    });

    it('MEMBER cannot invite — returns 403', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email: `anyone-${uid()}@test.local`, role: 'MEMBER' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for an invalid email address', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email: 'not-an-email', role: 'MEMBER' });

      expect(res.status).toBe(400);
    });
  });

  // ─── Pending → real auth0Id linking on first login ─────────────────────────

  describe('pending:uuid → real auth0Id linking on first GET /auth/me', () => {
    it('replaces the pending:uuid placeholder with the real Auth0 sub and preserves the membership', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const email = `link-flow-${uid()}@test.local`;

      // Step 1: invite creates the pending:uuid record
      vi.spyOn(auth0Service, 'sendInviteLink').mockResolvedValue(undefined);
      const inviteRes = await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email, role: 'MEMBER' });
      expect(inviteRes.status).toBe(201);

      const pendingUser = await prisma.user.findFirst({ where: { email } });
      expect(pendingUser!.auth0Id).toMatch(/^pending:/);
      const membershipId = (await prisma.membership.findFirst({
        where: { userId: pendingUser!.id },
      }))!.id;

      // Step 2: invitee clicks the magic link → Auth0 redirects → frontend calls /auth/me
      const realSub = `auth0|real-${uid()}`;
      const meRes = await agent
        .get('/auth/me')
        .set(
          'Authorization',
          `Bearer ${generateTestToken({ sub: realSub, email })}`,
        );
      expect(meRes.status).toBe(200);

      // The pending auth0Id is replaced by the real sub
      const linkedUser = await prisma.user.findUnique({
        where: { id: pendingUser!.id },
      });
      expect(linkedUser!.auth0Id).toBe(realSub);

      // The membership is preserved under the same user record
      const membership = await prisma.membership.findUnique({
        where: { id: membershipId },
      });
      expect(membership).not.toBeNull();
      expect(membership!.userId).toBe(pendingUser!.id);
    });
  });

  // ─── DELETE /organizations/:orgId/memberships/:id ───────────────────────────

  describe('DELETE /organizations/:orgId/memberships/:id', () => {
    it("removes membership, deletes Prisma user, and calls Auth0ManagementService.deleteUser when it is the user's last org", async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberAuth0Id = ctx.member!.auth0Id;
      const memberPrismaId = ctx.member!.user.id;
      const membershipId = ctx.member!.membership.id;

      // AUTH0_M2M_CLIENT_ID is absent in .env.test, so Auth0ManagementService
      // would throw before making any HTTP call. Spy replaces the implementation
      // so we verify orchestration (was it called? with what args?) without
      // hitting the network. The unit tests for Auth0ManagementService cover
      // the actual HTTP call independently.
      const deleteSpy = vi
        .spyOn(auth0Service, 'deleteUser')
        .mockResolvedValue(undefined);

      const res = await agent
        .delete(`/organizations/${ctx.org.id}/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: 'Membership deleted successfully',
      });

      // Auth0 deleteUser was called with the member's auth0Id
      expect(deleteSpy).toHaveBeenCalledWith(memberAuth0Id);
      deleteSpy.mockRestore();

      // Membership deleted
      const membership = await prisma.membership.findUnique({
        where: { id: membershipId },
      });
      expect(membership).toBeNull();

      // Prisma user deleted
      const user = await prisma.user.findUnique({
        where: { id: memberPrismaId },
      });
      expect(user).toBeNull();
    });

    it('skips Auth0 deletion for a pending-invited user who never logged in', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const email = `pending-remove-${uid()}@test.local`;

      // Invite creates the pending:uuid record
      vi.spyOn(auth0Service, 'sendInviteLink').mockResolvedValue(undefined);
      await agent
        .post(`/organizations/${ctx.org.id}/memberships/invite`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id)
        .send({ email, role: 'MEMBER' });

      const pendingUser = await prisma.user.findFirst({ where: { email } });
      const membershipId = (await prisma.membership.findFirst({
        where: { userId: pendingUser!.id },
      }))!.id;

      // Spy to assert Auth0 deleteUser is never called for pending users
      const deleteSpy = vi
        .spyOn(auth0Service, 'deleteUser')
        .mockResolvedValue(undefined);

      const res = await agent
        .delete(`/organizations/${ctx.org.id}/memberships/${membershipId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(deleteSpy).not.toHaveBeenCalled();
      deleteSpy.mockRestore();

      // Prisma user is cleaned up even though Auth0 was skipped
      const user = await prisma.user.findUnique({
        where: { id: pendingUser!.id },
      });
      expect(user).toBeNull();
    });

    it('preserves Auth0 account and Prisma record when the user still belongs to another org', async () => {
      const ctx1 = await seedFullOrg(prisma);
      const ctx2 = await seedFullOrg(prisma);
      const ownerToken1 = generateTestToken({ sub: ctx1.owner.auth0Id });

      // User belongs to both orgs
      const sharedUser = await createTestUser(prisma, {
        auth0Id: `auth0|shared-${uid()}`,
        email: `shared-${uid()}@test.local`,
      });
      const membership1 = await createTestMembership(
        prisma,
        sharedUser.id,
        ctx1.org.id,
        MembershipRole.MEMBER,
      );
      await createTestMembership(
        prisma,
        sharedUser.id,
        ctx2.org.id,
        MembershipRole.MEMBER,
      );

      const deleteSpy = vi
        .spyOn(auth0Service, 'deleteUser')
        .mockResolvedValue(undefined);

      const res = await agent
        .delete(`/organizations/${ctx1.org.id}/memberships/${membership1.id}`)
        .set('Authorization', `Bearer ${ownerToken1}`)
        .set('x-org-id', ctx1.org.id);

      expect(res.status).toBe(200);

      // Auth0 account NOT deleted — user still belongs to ctx2.org
      expect(deleteSpy).not.toHaveBeenCalled();
      deleteSpy.mockRestore();

      // Prisma user preserved
      const user = await prisma.user.findUnique({
        where: { id: sharedUser.id },
      });
      expect(user).not.toBeNull();

      // Only the first membership is removed
      const m1 = await prisma.membership.findUnique({
        where: { id: membership1.id },
      });
      expect(m1).toBeNull();
    });
  });
});
