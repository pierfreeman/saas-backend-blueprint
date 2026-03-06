/**
 * seed.helper.ts — Database seeding utilities for integration tests.
 *
 * Creates test users, organizations, and memberships in the business DB.
 * All records are scoped to a unique test run to prevent interference
 * between test suites when tests accidentally run concurrently.
 *
 * Usage:
 *   const ctx = await seedFullOrg(prisma, { withAdmin: true, withMember: true });
 *   // ctx.owner.auth0Id — use to generate test JWT
 *   // ctx.org.id       — use as :orgId in requests
 */
import { PrismaBusinessService } from '@libs/prisma-business';
import {
  MembershipRole,
  MembershipStatus,
  Organization,
  User,
  Membership,
} from '@prisma/client';
import * as crypto from 'crypto';

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface TestUserContext {
  user: User;
  membership: Membership;
  /** auth0Id to pass to generateTestToken({ sub: auth0Id }) */
  auth0Id: string;
}

export interface TestOrgContext {
  org: Organization;
  owner: TestUserContext;
  admin?: TestUserContext;
  member?: TestUserContext;
  readOnly?: TestUserContext;
}

// ─── Individual entity creators ───────────────────────────────────────────────

export async function createTestUser(
  prisma: PrismaBusinessService,
  overrides: { auth0Id?: string; email?: string } = {},
): Promise<User> {
  const id = shortId();
  return prisma.user.create({
    data: {
      auth0Id: overrides.auth0Id ?? `auth0|test-${id}`,
      email: overrides.email ?? `test-${id}@example.com`,
    },
  });
}

export async function createTestOrg(
  prisma: PrismaBusinessService,
  name?: string,
): Promise<Organization> {
  return prisma.organization.create({
    data: { name: name ?? `Test Org ${shortId()}` },
  });
}

export async function createTestMembership(
  prisma: PrismaBusinessService,
  userId: string,
  orgId: string,
  role: MembershipRole = MembershipRole.MEMBER,
  status: MembershipStatus = MembershipStatus.ACTIVE,
): Promise<Membership> {
  return prisma.membership.create({
    data: { userId, orgId, role, status },
  });
}

// ─── seedFullOrg ──────────────────────────────────────────────────────────────

export interface SeedFullOrgOptions {
  /** Include an ADMIN member. Default: false */
  withAdmin?: boolean;
  /** Include a MEMBER. Default: false */
  withMember?: boolean;
  /** Include a READ_ONLY member. Default: false */
  withReadOnly?: boolean;
  /** Org name override. */
  orgName?: string;
}

/**
 * Creates an organization with an OWNER and optionally ADMIN, MEMBER, READ_ONLY
 * members. Returns all relevant IDs for test assertions.
 */
export async function seedFullOrg(
  prisma: PrismaBusinessService,
  options: SeedFullOrgOptions = {},
): Promise<TestOrgContext> {
  const org = await createTestOrg(prisma, options.orgName);

  // OWNER
  const ownerAuth0Id = `auth0|owner-${shortId()}`;
  const ownerUser = await createTestUser(prisma, { auth0Id: ownerAuth0Id });
  const ownerMembership = await createTestMembership(
    prisma,
    ownerUser.id,
    org.id,
    MembershipRole.OWNER,
  );

  const context: TestOrgContext = {
    org,
    owner: {
      user: ownerUser,
      membership: ownerMembership,
      auth0Id: ownerAuth0Id,
    },
  };

  // ADMIN (optional)
  if (options.withAdmin) {
    const adminAuth0Id = `auth0|admin-${shortId()}`;
    const adminUser = await createTestUser(prisma, { auth0Id: adminAuth0Id });
    const adminMembership = await createTestMembership(
      prisma,
      adminUser.id,
      org.id,
      MembershipRole.ADMIN,
    );
    context.admin = {
      user: adminUser,
      membership: adminMembership,
      auth0Id: adminAuth0Id,
    };
  }

  // MEMBER (optional)
  if (options.withMember) {
    const memberAuth0Id = `auth0|member-${shortId()}`;
    const memberUser = await createTestUser(prisma, { auth0Id: memberAuth0Id });
    const memberMembership = await createTestMembership(
      prisma,
      memberUser.id,
      org.id,
      MembershipRole.MEMBER,
    );
    context.member = {
      user: memberUser,
      membership: memberMembership,
      auth0Id: memberAuth0Id,
    };
  }

  // READ_ONLY (optional)
  if (options.withReadOnly) {
    const readOnlyAuth0Id = `auth0|readonly-${shortId()}`;
    const readOnlyUser = await createTestUser(prisma, {
      auth0Id: readOnlyAuth0Id,
    });
    const readOnlyMembership = await createTestMembership(
      prisma,
      readOnlyUser.id,
      org.id,
      MembershipRole.READ_ONLY,
    );
    context.readOnly = {
      user: readOnlyUser,
      membership: readOnlyMembership,
      auth0Id: readOnlyAuth0Id,
    };
  }

  return context;
}
