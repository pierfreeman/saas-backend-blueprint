/**
 * tasks.integration.spec.ts
 *
 * Tests the task submission and job status API:
 *  POST /tasks/heavy-job  → creates a Job(PENDING) and publishes to EventBus (local)
 *  GET  /tasks/:jobId     → returns the job scoped to the tenant context
 *
 * The tasks routes use JwtAuthGuard + TenantMiddleware (via x-org-id header).
 * OrgContextGuard does NOT run on these routes — membership validation is not
 * enforced at this layer (handled upstream in production gateways).
 *
 * Note: EVENT_BUS_TRANSPORT=local in .env.test — no SQS required.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { JobStatus } from '@libs/prisma-business';

describe('Tasks (integration)', () => {
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

  // ─── POST /tasks/heavy-job ─────────────────────────────────────────────────

  describe('POST /tasks/heavy-job', () => {
    it('creates a PENDING job and returns 202', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post('/tasks/heavy-job')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({ data: { input: 'test-payload' } });

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ status: JobStatus.PENDING });
      expect(typeof res.body.id).toBe('string');
    });

    it('persists the job to the business DB with PENDING status', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Task Persist Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post('/tasks/heavy-job')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({ data: { key: 'value' } });

      expect(res.status).toBe(202);
      const jobId = res.body.id as string;

      const job = await prisma.job.findUnique({ where: { id: jobId } });
      expect(job).not.toBeNull();
      expect(job?.status).toBe(JobStatus.PENDING);
      expect(job?.orgId).toBe(ctx.org.id);
    });

    it('scopes the job to the org in x-org-id header', async () => {
      const ctxA = await seedFullOrg(prisma, { orgName: 'Task Scope Org A' });
      const ctxB = await seedFullOrg(prisma, { orgName: 'Task Scope Org B' });
      const tokenA = generateTestToken({ sub: ctxA.owner.auth0Id });

      const resA = await agent
        .post('/tasks/heavy-job')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-org-id', ctxA.org.id)
        .send({ data: {} });

      expect(resA.status).toBe(202);
      const jobId = resA.body.id as string;

      const job = await prisma.job.findUnique({ where: { id: jobId } });
      expect(job?.orgId).toBe(ctxA.org.id);
      expect(job?.orgId).not.toBe(ctxB.org.id);
    });

    it('returns 401 without Authorization header', async () => {
      const res = await agent
        .post('/tasks/heavy-job')
        .set('x-org-id', 'any-org-id')
        .send({ data: {} });

      expect(res.status).toBe(401);
    });
  });

  // ─── GET /tasks/:jobId ─────────────────────────────────────────────────────

  describe('GET /tasks/:jobId', () => {
    it('returns the job for the correct tenant context', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Task Get Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      // Create job
      const createRes = await agent
        .post('/tasks/heavy-job')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({ data: { test: true } });

      expect(createRes.status).toBe(202);
      const jobId = createRes.body.id as string;

      // Fetch job
      const getRes = await agent
        .get(`/tasks/${jobId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(getRes.status).toBe(200);
      expect(getRes.body).toMatchObject({
        id: jobId,
        status: JobStatus.PENDING,
      });
    });

    it('returns 404 when wrong org context is used (tenant isolation)', async () => {
      const ctxOwner = await seedFullOrg(prisma, { orgName: 'Task Owner Org' });
      const ctxOther = await seedFullOrg(prisma, { orgName: 'Task Other Org' });

      const ownerToken = generateTestToken({ sub: ctxOwner.owner.auth0Id });
      const otherToken = generateTestToken({ sub: ctxOther.owner.auth0Id });

      // Create job in ctxOwner's org
      const createRes = await agent
        .post('/tasks/heavy-job')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', ctxOwner.org.id)
        .send({ data: {} });

      expect(createRes.status).toBe(202);
      const jobId = createRes.body.id as string;

      // Try to access the job from a different org's context
      const getRes = await agent
        .get(`/tasks/${jobId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('x-org-id', ctxOther.org.id);

      expect(getRes.status).toBe(404);
    });

    it('returns 401 without Authorization header', async () => {
      const res = await agent
        .get('/tasks/00000000-0000-0000-0000-000000000000')
        .set('x-org-id', 'any-id');

      expect(res.status).toBe(401);
    });
  });
});
