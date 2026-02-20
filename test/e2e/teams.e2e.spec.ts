import {
  INestApplication,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import request from 'supertest';
import { TestAppFactory } from '../setup/test-app.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { RBACGuard } from '../../src/modules/rbac/guards/rbac.guard';

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== 'mock-jwt-token') {
      throw new UnauthorizedException('Authentication required');
    }

    request.user = {
      sub: 'auth0|teams-e2e',
      email: 'teams@test.com',
    };

    return true;
  }
}

class MockRBACGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const method = request.method as string;
    const role = request.membership?.role as string | undefined;

    if (role === 'VIEWER' && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }

    return true;
  }
}

describe('Teams E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    app = await TestAppFactory.createApp({
      guards: [
        {
          provide: JwtAuthGuard,
          useValue: new MockJwtAuthGuard(),
        },
        {
          provide: RBACGuard,
          useValue: new MockRBACGuard(),
        },
      ],
    });
    prisma = app.get(PrismaService);

    // Create test user
    userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await prisma.user.create({
      data: {
        id: userId,
        auth0Id: 'auth0|teams-e2e',
        email: 'teams@test.com',
      },
    });

    // Create organization
    const org = await prisma.organization.create({
      data: { name: 'Test Organization' },
    });
    orgId = org.id;

    // Add user as ADMIN
    await prisma.membership.create({
      data: {
        userId,
        orgId,
        role: 'ADMIN',
      },
    });

    authToken = 'Bearer mock-jwt-token';
  });

  afterAll(async () => {
    await TestAppFactory.cleanup(app);
  });

  beforeEach(async () => {
    // Clean teams before each test
    await prisma.team.deleteMany({ where: { orgId } });
    await prisma.membership.updateMany({
      where: { userId, orgId },
      data: { role: 'ADMIN' },
    });
  });

  describe('POST /organizations/:orgId/teams', () => {
    it('should return 401 without authentication', async () => {
      const response = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .send({ name: 'Test Team' });

      expect(response.status).toBe(401);
    });

    it('should create team with valid data', async () => {
      const response = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team Alpha' });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Team Alpha');
      expect(response.body.orgId).toBe(orgId);
    });

    it('should return 400 with invalid data', async () => {
      const response = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'A' }); // Too short

      expect(response.status).toBe(400);
    });

    it('should enforce team limit for FREE plan', async () => {
      // Create subscription with FREE plan (limit: 2 teams)
      await prisma.subscription.create({
        data: {
          orgId,
          stripeSubscriptionId: 'sub_free',
          plan: 'FREE',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-12-31'),
          cancelAtPeriodEnd: false,
        },
      });

      // Create 2 teams (at limit)
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team 1' });

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team 2' });

      // Try to create 3rd team (should fail)
      const response = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team 3' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Team limit reached');
    });
  });

  describe('GET /organizations/:orgId/teams', () => {
    it('should return empty array when no teams', async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return organization teams', async () => {
      // Create teams
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team A' });

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Team B' });

      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });

    it('should not expose teams from other organizations', async () => {
      // Create another org
      const org2 = await prisma.organization.create({
        data: { name: 'Other Org' },
      });

      // Create team in org2
      await prisma.team.create({
        data: {
          name: 'Secret Team',
          orgId: org2.id,
        },
      });

      // Request teams from orgId
      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
      expect(response.body.find((t: any) => t.name === 'Secret Team')).toBeUndefined();
    });
  });

  describe('GET /organizations/:orgId/teams/:id', () => {
    it('should return team by id', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Findable Team' });

      const teamId = createResponse.body.id;

      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${teamId}`)
        .set('Authorization', authToken);

      expect(response.status).toBe(200);
      expect(response.body.id).toBe(teamId);
      expect(response.body.name).toBe('Findable Team');
    });

    it('should return 404 for non-existent team', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${fakeId}`)
        .set('Authorization', authToken);

      expect(response.status).toBe(404);
    });

    it('should return 404 when team belongs to different org', async () => {
      // Create another org
      const org2 = await prisma.organization.create({
        data: { name: 'Other Org 2' },
      });

      const team2 = await prisma.team.create({
        data: {
          name: 'Other Team',
          orgId: org2.id,
        },
      });

      // Try to access from orgId context
      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/teams/${team2.id}`)
        .set('Authorization', authToken);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /organizations/:orgId/teams/:id', () => {
    it('should update team', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Original Team' });

      const teamId = createResponse.body.id;

      const updateResponse = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${teamId}`)
        .set('Authorization', authToken)
        .send({ name: 'Updated Team' });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.name).toBe('Updated Team');
    });

    it('should return 403 for VIEWER role', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'Protected Team' });

      const teamId = createResponse.body.id;

      // Change role to VIEWER
      await prisma.membership.updateMany({
        where: { userId, orgId },
        data: { role: 'VIEWER' },
      });

      const updateResponse = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/teams/${teamId}`)
        .set('Authorization', authToken)
        .send({ name: 'Hacked Team' });

      expect(updateResponse.status).toBe(403);
    });
  });

  describe('DELETE /organizations/:orgId/teams/:id', () => {
    it('should delete team', async () => {
      const createResponse = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/teams`)
        .set('Authorization', authToken)
        .send({ name: 'To Delete' });

      const teamId = createResponse.body.id;

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/organizations/${orgId}/teams/${teamId}`)
        .set('Authorization', authToken);

      expect(deleteResponse.status).toBe(200);

      // Verify deletion
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });
      expect(team).toBeNull();
    });
  });
});
