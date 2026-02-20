import {
	INestApplication,
	CanActivate,
	ExecutionContext,
	UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { TestAppFactory } from '../setup/test-app.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';

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
			sub: 'auth0|e2e-test',
			email: 'e2e@test.com',
		};

		return true;
	}
}

describe('Organizations E2E Tests', () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let authToken: string;
	let userId: string;

	beforeAll(async () => {
		app = await TestAppFactory.createApp({
			guards: [
				{
					provide: JwtAuthGuard,
					useValue: new MockJwtAuthGuard(),
				},
			],
		});
		prisma = app.get(PrismaService);

		// Create test user
		userId = '88888888-8888-4888-8888-888888888888';
		await prisma.user.create({
			data: {
				id: userId,
				auth0Id: 'auth0|e2e-test',
				email: 'e2e@test.com',
			},
		});

		// Mock JWT token (in real app, generate valid JWT or mock auth guard)
		authToken = 'Bearer mock-jwt-token';
	});

	afterAll(async () => {
		await TestAppFactory.cleanup(app);
	});

	beforeEach(async () => {
		// Clean organizations before each test
		await prisma.membership.deleteMany();
		await prisma.team.deleteMany();
		await prisma.organization.deleteMany();
	});

	describe('POST /organizations', () => {
		it('should return 401 without authentication', async () => {
			const response = await request(app.getHttpServer())
				.post('/organizations')
				.send({ name: 'Test Org' });

			expect(response.status).toBe(401);
		});

		it('should create organization with valid token', async () => {
			const response = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'My Organization' });

			expect(response.status).toBe(201);
			expect(response.body).toHaveProperty('id');
			expect(response.body.name).toBe('My Organization');
			expect(response.body.status).toBe('ACTIVE');
		});

		it('should automatically create OWNER membership', async () => {
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Owned Org' });

			expect(createResponse.status).toBe(201);

			const orgId = createResponse.body.id;

			// Verify membership exists
			const membership = await prisma.membership.findFirst({
				where: { userId, orgId },
			});

			expect(membership).toBeDefined();
			expect(membership?.role).toBe('OWNER');
		});

		it('should return 400 with invalid data', async () => {
			const response = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'A' }); // Too short (min 3 chars)

			expect(response.status).toBe(400);
		});
	});

	describe('GET /organizations', () => {
		it('should return empty array when user has no organizations', async () => {
			const response = await request(app.getHttpServer())
				.get('/organizations')
				.set('Authorization', authToken);

			expect(response.status).toBe(200);
			expect(response.body).toEqual([]);
		});

		it('should return user organizations', async () => {
			// Create two organizations
			await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Org 1' });

			await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Org 2' });

			const response = await request(app.getHttpServer())
				.get('/organizations')
				.set('Authorization', authToken);

			expect(response.status).toBe(200);
			expect(response.body).toHaveLength(2);
			expect(response.body[0]).toHaveProperty('id');
			expect(response.body[1]).toHaveProperty('id');
		});
	});

	describe('GET /organizations/:id', () => {
		it('should return 403 when user has no membership', async () => {
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Findable Org' });

			const orgId = createResponse.body.id;

			// Remove the auto-created OWNER membership so the user has no access
			await prisma.membership.deleteMany({ where: { orgId } });

			const response = await request(app.getHttpServer())
				.get(`/organizations/${orgId}`)
				.set('Authorization', authToken)
				.set('x-org-id', orgId);

			expect(response.status).toBe(403);
		});

		it('should return 403 for non-existent organization without membership', async () => {
			const fakeId = '00000000-0000-0000-0000-000000000000';

			const response = await request(app.getHttpServer())
				.get(`/organizations/${fakeId}`)
				.set('Authorization', authToken)
				.set('x-org-id', fakeId);

			expect(response.status).toBe(403);
		});

		it('should return 403 when user is not member', async () => {
			// Create another user and their organization
			const otherUserId = '99999999-9999-4999-8999-999999999999';
			await prisma.user.create({
				data: {
					id: otherUserId,
					auth0Id: 'auth0|other',
					email: 'other@test.com',
				},
			});

			const org = await prisma.organization.create({
				data: { name: 'Other Org' },
			});

			await prisma.membership.create({
				data: {
					userId: otherUserId,
					orgId: org.id,
					role: 'OWNER',
				},
			});

			// Try to access with original user
			const response = await request(app.getHttpServer())
				.get(`/organizations/${org.id}`)
				.set('Authorization', authToken)
				.set('x-org-id', org.id);

			expect(response.status).toBe(403);
		});
	});

	describe('PATCH /organizations/:id', () => {
		it('should return 403 without ORG_MANAGE permission on update', async () => {
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Original Name' });

			const orgId = createResponse.body.id;

			// Remove membership so user has no permissions on this org
			await prisma.membership.deleteMany({ where: { orgId } });

			const updateResponse = await request(app.getHttpServer())
				.patch(`/organizations/${orgId}`)
				.set('Authorization', authToken)
				.set('x-org-id', orgId)
				.send({ name: 'Updated Name' });

			expect(updateResponse.status).toBe(403);
		});

		it('should return 403 when user is not OWNER or ADMIN', async () => {
			// Create organization with original user as OWNER
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Protected Org' });

			const orgId = createResponse.body.id;

			// Change membership to VIEWER
			await prisma.membership.updateMany({
				where: { userId, orgId },
				data: { role: 'VIEWER' },
			});

			const updateResponse = await request(app.getHttpServer())
				.patch(`/organizations/${orgId}`)
				.set('Authorization', authToken)
				.set('x-org-id', orgId)
				.send({ name: 'Hacked Name' });

			expect(updateResponse.status).toBe(403);
		});
	});

	describe('DELETE /organizations/:id', () => {
		it('should return 403 without ORG_MANAGE permission on delete', async () => {
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'To Delete' });

			const orgId = createResponse.body.id;

			// Remove membership so user has no permissions on this org
			await prisma.membership.deleteMany({ where: { orgId } });

			const deleteResponse = await request(app.getHttpServer())
				.delete(`/organizations/${orgId}`)
				.set('Authorization', authToken)
				.set('x-org-id', orgId);

			expect(deleteResponse.status).toBe(403);
		});

		it('should return 403 when user does not have ORG_MANAGE (MEMBER role)', async () => {
			const createResponse = await request(app.getHttpServer())
				.post('/organizations')
				.set('Authorization', authToken)
				.send({ name: 'Protected Delete' });

			const orgId = createResponse.body.id;

			// Downgrade to MEMBER — does not have ORG_MANAGE permission
			await prisma.membership.updateMany({
				where: { userId, orgId },
				data: { role: 'MEMBER' },
			});

			const deleteResponse = await request(app.getHttpServer())
				.delete(`/organizations/${orgId}`)
				.set('Authorization', authToken)
				.set('x-org-id', orgId);

			expect(deleteResponse.status).toBe(403);
		});
	});
});
