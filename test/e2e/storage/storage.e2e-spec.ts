import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StorageProvider, SubscriptionPlan } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';

describe('Storage API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  async function setupTestData() {
    // Create test organization
    const org = await prisma.organization.create({
      data: {
        name: 'Test Org',
        status: 'ACTIVE',
      },
    });
    orgId = org.id;

    // Create test user
    const user = await prisma.user.create({
      data: {
        auth0Id: 'test-auth0-id',
        email: 'test@example.com',
      },
    });
    userId = user.id;

    // Create membership
    await prisma.membership.create({
      data: {
        userId: user.id,
        orgId: org.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    // Create subscription
    await prisma.subscription.create({
      data: {
        orgId: org.id,
        plan: SubscriptionPlan.PRO,
        status: 'ACTIVE',
      },
    });

    // Mock auth token (in real test, generate valid JWT)
    authToken = 'mock-jwt-token';
  }

  async function cleanupTestData() {
    await prisma.membership.deleteMany({ where: { orgId } });
    await prisma.subscription.deleteMany({ where: { orgId } });
    await prisma.uploadSession.deleteMany({ where: { orgId } });
    await prisma.file.deleteMany({ where: { orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
  }

  describe('POST /storage/upload-session', () => {
    it('should create upload session', () => {
      return request(app.getHttpServer())
        .post('/storage/upload-session')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-org-id', orgId)
        .send({
          fileName: 'test-video.mp4',
          mimeType: 'video/mp4',
          expectedSize: 10485760, // 10MB
          storageProvider: StorageProvider.S3,
        })
        .expect(201)
        .then((response) => {
          expect(response.body.uploadSessionId).toBeDefined();
          expect(response.body.uploadConfig).toBeDefined();
          expect(response.body.uploadConfig.uploadId).toBeDefined();
          expect(response.body.uploadConfig.partSize).toBeGreaterThan(0);
          expect(response.body.uploadConfig.partCount).toBeGreaterThan(0);
        });
    });

    it('should reject upload if quota exceeded', () => {
      return request(app.getHttpServer())
        .post('/storage/upload-session')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-org-id', orgId)
        .send({
          fileName: 'huge-file.mp4',
          mimeType: 'video/mp4',
          expectedSize: 100 * 1024 * 1024 * 1024, // 100GB (exceeds PRO limit)
          storageProvider: StorageProvider.S3,
        })
        .expect(403);
    });
  });

  describe('GET /storage/quota', () => {
    it('should return quota usage', () => {
      return request(app.getHttpServer())
        .get('/storage/quota')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-org-id', orgId)
        .expect(200)
        .then((response) => {
          expect(response.body.plan).toBe(SubscriptionPlan.PRO);
          expect(response.body.storageUsedBytes).toBeDefined();
          expect(response.body.fileCount).toBeDefined();
        });
    });
  });

  describe('GET /storage/files', () => {
    it('should list files for organization', () => {
      return request(app.getHttpServer())
        .get('/storage/files')
        .set('Authorization', `Bearer ${authToken}`)
        .set('x-org-id', orgId)
        .query({ limit: 10, offset: 0 })
        .expect(200)
        .then((response) => {
          expect(response.body.files).toBeInstanceOf(Array);
          expect(response.body.count).toBeDefined();
        });
    });
  });
});
