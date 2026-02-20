import { INestApplication, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { TestAppFactory } from '../setup/test-app.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RBACService } from '../../src/modules/rbac/services/rbac.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { MembershipRole, MembershipStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Dynamic mock guard: accepts tokens in the format  mock-jwt-{auth0Id}
// Sets req.user.sub = auth0Id so the real OrgContextGuard can look up the user
// ---------------------------------------------------------------------------
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const PREFIX = 'mock-jwt-';
    if (!token.startsWith(PREFIX)) {
      throw new UnauthorizedException('Invalid token');
    }

    const auth0Id = token.slice(PREFIX.length);
    req.user = { sub: auth0Id, email: `${auth0Id.replace('|', '.')}@test.com` };
    return true;
  }
}

/** Generates a mock Bearer token for a given auth0 ID */
function mockToken(auth0Id: string): string {
  return `Bearer mock-jwt-${auth0Id}`;
}

// ---------------------------------------------------------------------------
// Role → permissions seed matrix
// ---------------------------------------------------------------------------
const ROLE_PERMISSIONS: Record<string, string[]> = {
  OWNER: [
    'org.manage', 'org.billing.manage', 'org.members.invite', 'org.members.remove',
    'org.members.role.update', 'org.read',
    'team.create', 'team.update', 'team.delete', 'team.read',
    'player.create', 'player.update', 'player.delete', 'player.read',
  ],
  ADMIN: [
    'org.manage', 'org.members.invite', 'org.members.remove', 'org.members.role.update', 'org.read',
    'team.create', 'team.update', 'team.delete', 'team.read',
    'player.create', 'player.update', 'player.delete', 'player.read',
  ],
  MEMBER: [
    'org.read',
    'team.create', 'team.update', 'team.read',
    'player.create', 'player.update', 'player.read',
  ],
  COACH: [
    'org.read', 'team.read',
    'player.create', 'player.update', 'player.read',
  ],
  VIEWER: ['org.read', 'team.read', 'player.read'],
  READ_ONLY: ['org.read', 'team.read', 'player.read'],
};

/** Seeds roles + permissions tables and refreshes the in-memory RBAC cache */
async function seedRolePermissions(prisma: PrismaService, rbacService: RBACService): Promise<void> {
  const allKeys = [...new Set(Object.values(ROLE_PERMISSIONS).flat())];

  for (const key of allKeys) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, description: key, category: key.split('.')[0] },
      update: {},
    });
  }

  for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName, scope: 'ORG' },
      update: {},
    });

    for (const key of permKeys) {
      const perm = await prisma.permission.findUnique({ where: { key } });
      if (perm) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
          create: { roleId: role.id, permissionId: perm.id },
          update: {},
        });
      }
    }
  }

  // The RBACService loads permissions at module init (DB was empty then) — refresh.
  await rbacService.refreshPermissionsCache();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('RBAC E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const auth0 = {
    owner:    'auth0|rbac-owner',
    admin:    'auth0|rbac-admin',
    member:   'auth0|rbac-member',
    coach:    'auth0|rbac-coach',
    viewer:   'auth0|rbac-viewer',
    readOnly: 'auth0|rbac-readonly',
  };

  let users: Record<string, { id: string; auth0Id: string }>;
  let testOrg:    { id: string; name: string };
  let testTeam:   { id: string };
  let testPlayer: { id: string };

  beforeAll(async () => {
    app = await TestAppFactory.createApp({
      guards: [{ provide: JwtAuthGuard, useValue: new MockJwtAuthGuard() }],
    });
    prisma = app.get(PrismaService);
    const rbacService = app.get(RBACService);

    await seedRolePermissions(prisma, rbacService);

    testOrg = await prisma.organization.create({
      data: { name: 'RBAC Test Org' },
    });

    const userEntries = await Promise.all(
      Object.entries(auth0).map(([key, auth0Id]) =>
        prisma.user.create({ data: { auth0Id, email: `${auth0Id.replace('|', '.')}@test.com` } })
          .then((u) => [key, u] as const),
      ),
    );
    users = Object.fromEntries(userEntries);

    const roleMap: Record<string, MembershipRole> = {
      owner:    MembershipRole.OWNER,
      admin:    MembershipRole.ADMIN,
      member:   MembershipRole.MEMBER,
      coach:    MembershipRole.COACH,
      viewer:   MembershipRole.VIEWER,
      readOnly: MembershipRole.READ_ONLY,
    };

    await Promise.all(
      Object.entries(roleMap).map(([key, role]) =>
        prisma.membership.create({
          data: {
            userId: users[key].id,
            orgId:  testOrg.id,
            role,
            status: MembershipStatus.ACTIVE,
          },
        }),
      ),
    );

    testTeam = await prisma.team.create({
      data: { name: 'Test Team', orgId: testOrg.id },
    });

    testPlayer = await prisma.player.create({
      data: {
        firstName: 'Test',
        lastName:  'Player',
        orgId:     testOrg.id,
        teamId:    testTeam.id,
      },
    });
  });

  afterAll(async () => {
    await TestAppFactory.cleanup(app);
  });

  // -------------------------------------------------------------------------
  // Authentication baseline
  // -------------------------------------------------------------------------
  describe('Authentication', () => {
    it('should return 401 without a token', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/teams`)
        .expect(401);
    });

    it('should return 401 with an invalid token prefix', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', 'Bearer not-a-mock-jwt')
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  // Organizations
  // GET/PATCH/DELETE /organizations/:id  need x-org-id because URL param is
  // :id (not :orgId) — OrgContextGuard falls back to the x-org-id header
  // -------------------------------------------------------------------------
  describe('Organization Endpoints', () => {
    it('OWNER can read organization', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.owner))
        .set('x-org-id', testOrg.id);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testOrg.id);
    });

    it('VIEWER can read organization', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.viewer))
        .set('x-org-id', testOrg.id)
        .expect(200);
    });

    it('OWNER can update organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.owner))
        .set('x-org-id', testOrg.id)
        .send({ name: 'RBAC Test Org Updated' })
        .expect(200);
    });

    it('ADMIN can update organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.admin))
        .set('x-org-id', testOrg.id)
        .send({ name: 'RBAC Test Org Admin' })
        .expect(200);
    });

    it('MEMBER cannot update organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.member))
        .set('x-org-id', testOrg.id)
        .send({ name: 'Unauthorized' })
        .expect(403);
    });

    it('VIEWER cannot update organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}`)
        .set('Authorization', mockToken(auth0.viewer))
        .set('x-org-id', testOrg.id)
        .send({ name: 'Unauthorized' })
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Teams (orgId in URL → OrgContextGuard extracts it from params)
  // -------------------------------------------------------------------------
  describe('Team Endpoints', () => {
    it('OWNER can create a team', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.owner))
        .send({ name: 'Owner Team' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Owner Team');
      await prisma.team.delete({ where: { id: res.body.id } });
    });

    it('ADMIN can create a team', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.admin))
        .send({ name: 'Admin Team' })
        .expect(201);

      await prisma.team.delete({ where: { id: res.body.id } });
    });

    it('MEMBER can create a team', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.member))
        .send({ name: 'Member Team' })
        .expect(201);

      await prisma.team.delete({ where: { id: res.body.id } });
    });

    it('COACH cannot create a team', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.coach))
        .send({ name: 'Unauthorized' })
        .expect(403);
    });

    it('VIEWER cannot create a team', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.viewer))
        .send({ name: 'Unauthorized' })
        .expect(403);
    });

    it('VIEWER can read teams', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.viewer))
        .expect(200);
    });

    it('COACH can read teams', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.coach))
        .expect(200);
    });

    it('MEMBER can update a team', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}/teams/${testTeam.id}`)
        .set('Authorization', mockToken(auth0.member))
        .send({ name: 'Member Updated Team' })
        .expect(200);
    });

    it('VIEWER cannot update a team', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}/teams/${testTeam.id}`)
        .set('Authorization', mockToken(auth0.viewer))
        .send({ name: 'Unauthorized' })
        .expect(403);
    });

    it('ADMIN can delete a team', async () => {
      const team = await prisma.team.create({
        data: { name: 'To Delete', orgId: testOrg.id },
      });

      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/teams/${team.id}`)
        .set('Authorization', mockToken(auth0.admin))
        .expect(200);
    });

    it('VIEWER cannot delete a team', async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/teams/${testTeam.id}`)
        .set('Authorization', mockToken(auth0.viewer))
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------
  describe('Player Endpoints', () => {
    it('COACH can create a player', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/players`)
        .set('Authorization', mockToken(auth0.coach))
        .send({ firstName: 'Coach', lastName: 'Created', teamId: testTeam.id })
        .expect(201);

      await prisma.player.delete({ where: { id: res.body.id } });
    });

    it('MEMBER can create a player', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/players`)
        .set('Authorization', mockToken(auth0.member))
        .send({ firstName: 'Member', lastName: 'Created', teamId: testTeam.id })
        .expect(201);

      await prisma.player.delete({ where: { id: res.body.id } });
    });

    it('VIEWER cannot create a player', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/players`)
        .set('Authorization', mockToken(auth0.viewer))
        .send({ firstName: 'Unauth', lastName: 'Player', teamId: testTeam.id })
        .expect(403);
    });

    it('VIEWER can read players', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/players`)
        .set('Authorization', mockToken(auth0.viewer))
        .expect(200);
    });

    it('COACH can read players', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/players`)
        .set('Authorization', mockToken(auth0.coach))
        .expect(200);
    });

    it('COACH can update a player', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}/players/${testPlayer.id}`)
        .set('Authorization', mockToken(auth0.coach))
        .send({ firstName: 'Updated' })
        .expect(200);
    });

    it('VIEWER cannot update a player', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${testOrg.id}/players/${testPlayer.id}`)
        .set('Authorization', mockToken(auth0.viewer))
        .send({ firstName: 'Unauthorized' })
        .expect(403);
    });

    it('ADMIN can delete a player', async () => {
      const player = await prisma.player.create({
        data: {
          firstName: 'Delete', lastName: 'Me',
          orgId: testOrg.id, teamId: testTeam.id,
        },
      });

      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/players/${player.id}`)
        .set('Authorization', mockToken(auth0.admin))
        .expect(200);
    });

    it('COACH cannot delete a player', async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/players/${testPlayer.id}`)
        .set('Authorization', mockToken(auth0.coach))
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Memberships
  // -------------------------------------------------------------------------
  describe('Membership Endpoints', () => {
    it('all active roles can read memberships', async () => {
      for (const auth0Id of Object.values(auth0)) {
        await request(app.getHttpServer())
          .get(`/organizations/${testOrg.id}/memberships`)
          .set('Authorization', mockToken(auth0Id))
          .expect(200);
      }
    });

    it('OWNER can invite a new member', async () => {
      const newUser = await prisma.user.create({
        data: { auth0Id: 'auth0|rbac-invitee', email: 'invitee@test.com' },
      });

      const res = await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/memberships`)
        .set('Authorization', mockToken(auth0.owner))
        .send({ userId: newUser.id, orgId: testOrg.id, role: MembershipRole.VIEWER });

      expect(res.status).toBe(201);

      await prisma.membership.deleteMany({ where: { userId: newUser.id } });
      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it('ADMIN can invite a new member', async () => {
      const newUser = await prisma.user.create({
        data: { auth0Id: 'auth0|rbac-invitee2', email: 'invitee2@test.com' },
      });

      await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/memberships`)
        .set('Authorization', mockToken(auth0.admin))
        .send({ userId: newUser.id, orgId: testOrg.id, role: MembershipRole.MEMBER })
        .expect(201);

      await prisma.membership.deleteMany({ where: { userId: newUser.id } });
      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it('MEMBER cannot invite a new member', async () => {
      const newUser = await prisma.user.create({
        data: { auth0Id: 'auth0|rbac-invitee3', email: 'invitee3@test.com' },
      });

      await request(app.getHttpServer())
        .post(`/organizations/${testOrg.id}/memberships`)
        .set('Authorization', mockToken(auth0.member))
        .send({ userId: newUser.id, orgId: testOrg.id, role: MembershipRole.VIEWER })
        .expect(403);

      await prisma.user.delete({ where: { id: newUser.id } });
    });

    it('OWNER can remove a member', async () => {
      const tmpUser = await prisma.user.create({
        data: { auth0Id: 'auth0|rbac-toremove', email: 'toremove@test.com' },
      });
      const membership = await prisma.membership.create({
        data: {
          userId: tmpUser.id, orgId: testOrg.id,
          role: MembershipRole.VIEWER, status: MembershipStatus.ACTIVE,
        },
      });

      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/memberships/${membership.id}`)
        .set('Authorization', mockToken(auth0.owner))
        .expect(200);

      await prisma.user.delete({ where: { id: tmpUser.id } });
    });

    it('MEMBER cannot remove a member', async () => {
      const membership = await prisma.membership.findFirst({
        where: { userId: users.viewer.id, orgId: testOrg.id },
      });

      await request(app.getHttpServer())
        .delete(`/organizations/${testOrg.id}/memberships/${membership!.id}`)
        .set('Authorization', mockToken(auth0.member))
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Membership status
  // -------------------------------------------------------------------------
  describe('Suspended Membership', () => {
    it('suspended member is denied access', async () => {
      await prisma.membership.updateMany({
        where: { userId: users.coach.id, orgId: testOrg.id },
        data: { status: MembershipStatus.SUSPENDED },
      });

      await request(app.getHttpServer())
        .get(`/organizations/${testOrg.id}/teams`)
        .set('Authorization', mockToken(auth0.coach))
        .expect(403);

      // Restore
      await prisma.membership.updateMany({
        where: { userId: users.coach.id, orgId: testOrg.id },
        data: { status: MembershipStatus.ACTIVE },
      });
    });
  });
});
