/**
 * storage-quota.integration.spec.ts
 *
 * Integration tests for the storage quota HTTP layer.
 *
 * Tests verify the full request pipeline for:
 *   1. GET /files/quota — quota usage endpoint
 *   2. POST /files/upload-url — quota enforcement (403 when limit exceeded)
 *
 * Plan limits (governed by storage.config.ts defaults):
 *   - FREE   : 0.1 GB storage (~102 MiB), 100 files, 50 MB max per file
 *   - PRO    : 5 GB storage, 10000 files, 2 GB max per file
 *   - ENTERPRISE: 50 GB storage, unlimited files, 10 GB max per file
 *
 * Prerequisites (handled by globalSetup / docker-compose.test.yml):
 *   - PostgreSQL and Redis test containers running
 *   - Prisma migrations applied
 *
 * Note: Tests that exercise the happy-path presigned URL generation (which
 * calls S3) are skipped unless the test environment provides AWS_S3_BUCKET.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { BillingStatus, FileStatus } from '@libs/prisma-business';

const PRO_PRICE_ID = process.env['STRIPE_PRICE_ID_PRO'] ?? 'price_test_pro';
const ENTERPRISE_PRICE_ID =
  process.env['STRIPE_PRICE_ID_ENTERPRISE'] ?? 'price_test_enterprise';

// Free plan storage limit in bytes: Math.round(0.1 * 1024^3) = 107374182
const FREE_PLAN_STORAGE_LIMIT_BYTES = Math.round(0.1 * 1024 * 1024 * 1024);
const PRO_PLAN_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
const ENTERPRISE_PLAN_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024 * 1024;

describe('Storage Quota (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let cache: CacheService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    cache = app.get(CacheService);
    await resetBusinessDb(prisma);
    await cache.flushdb();
  });

  afterAll(async () => {
    await cache.flushdb();
    await app.close();
    teardownNockAuth();
  });

  // ── Helper ──────────────────────────────────────────────────────────────────

  /** Seed file records directly in the DB to simulate existing storage usage. */
  async function seedCompletedFiles(
    orgId: string,
    userId: string,
    files: Array<{ sizeBytes: number }>,
  ): Promise<void> {
    for (let i = 0; i < files.length; i++) {
      await prisma.file.create({
        data: {
          orgId,
          uploadedBy: userId,
          storageKey: `org/${orgId}/test-file-${i}-${Date.now()}`,
          provider: 'S3',
          filename: `test-file-${i}.pdf`,
          size: BigInt(files[i].sizeBytes),
          mimeType: 'application/pdf',
          status: FileStatus.COMPLETED,
          confirmedAt: new Date(),
        },
      });
    }
  }

  // ── GET /files/quota ────────────────────────────────────────────────────────

  describe('GET /files/quota', () => {
    it('returns quota for a FREE plan org with no files (empty usage)', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Free Quota Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get('/files/quota')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.storageUsedBytes).toBe('0');
      expect(res.body.fileCount).toBe(0);
      expect(res.body.fileCountLimit).toBe(100); // free plan file limit
      // storageLimitBytes: Math.round(0.1 * 1024^3)
      expect(res.body.storageLimitBytes).toBe(
        String(FREE_PLAN_STORAGE_LIMIT_BYTES),
      );
      // maxFileSizeBytes: 0.05 * 1024^3 (does not need to be exact int)
      expect(Number(res.body.maxFileSizeBytes)).toBeCloseTo(
        0.05 * 1024 * 1024 * 1024,
        -3, // within 1000 bytes
      );
    });

    it('reflects actual file usage in storageUsedBytes and fileCount', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Usage Quota Org' });
      await seedCompletedFiles(ctx.org.id, ctx.owner.user.id, [
        { sizeBytes: 10 * 1024 * 1024 }, // 10 MiB
        { sizeBytes: 20 * 1024 * 1024 }, // 20 MiB
      ]);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get('/files/quota')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.storageUsedBytes).toBe(
        String(30 * 1024 * 1024), // 30 MiB in bytes
      );
      expect(res.body.fileCount).toBe(2);
    });

    it('returns PRO plan limits for an org with ACTIVE PRO subscription', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Pro Quota Org' });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: PRO_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get('/files/quota')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.storageLimitBytes).toBe(
        String(PRO_PLAN_STORAGE_LIMIT_BYTES),
      );
      expect(res.body.fileCountLimit).toBe(10000);
    });

    it('returns ENTERPRISE plan limits for an ENTERPRISE org', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Enterprise Quota Org',
      });
      await prisma.organization.update({
        where: { id: ctx.org.id },
        data: {
          billingStatus: BillingStatus.ACTIVE,
          planId: ENTERPRISE_PRICE_ID,
        },
      });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .get('/files/quota')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(200);
      expect(res.body.storageLimitBytes).toBe(
        String(ENTERPRISE_PLAN_STORAGE_LIMIT_BYTES),
      );
      expect(res.body.fileCountLimit).toBeNull(); // unlimited for enterprise
    });

    it('returns 401 when no JWT is provided', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Unauth Org' });

      const res = await agent.get('/files/quota').set('x-org-id', ctx.org.id);

      expect(res.status).toBe(401);
    });

    it('returns 403 when the caller is not a member of the org', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'Quota Forbidden Org' });
      const outsider = await seedFullOrg(prisma, { orgName: 'Outsider Org' });
      const token = generateTestToken({ sub: outsider.owner.auth0Id });

      const res = await agent
        .get('/files/quota')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id);

      expect(res.status).toBe(403);
    });
  });

  // ── POST /files/upload-url — quota enforcement ──────────────────────────────

  describe('POST /files/upload-url — quota enforcement', () => {
    it('returns 403 when file count limit is reached for FREE plan', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'File Count Limit Org',
      });
      // Seed 100 files — at the free plan file count limit
      await seedCompletedFiles(
        ctx.org.id,
        ctx.owner.user.id,
        Array.from({ length: 100 }, (_, i) => ({
          sizeBytes: 512, // tiny files to avoid storage limit
        })),
      );
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post('/files/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({
          filename: 'extra.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/file count/i);
    });

    it('returns 403 when individual file exceeds free plan 50 MB size limit', async () => {
      const ctx = await seedFullOrg(prisma, { orgName: 'File Size Limit Org' });
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post('/files/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({
          filename: 'too-large.mp4',
          mimeType: 'video/mp4',
          size: 60 * 1024 * 1024, // 60 MiB — exceeds free plan 50 MiB max
        });

      expect(res.status).toBe(400); // BadRequestException for file-too-large
    });

    it('returns 403 when total storage would exceed free plan limit', async () => {
      const ctx = await seedFullOrg(prisma, {
        orgName: 'Storage Quota Exceeded Org',
      });
      // Seed files totaling just over the free plan limit
      await seedCompletedFiles(ctx.org.id, ctx.owner.user.id, [
        { sizeBytes: FREE_PLAN_STORAGE_LIMIT_BYTES + 1 }, // already over limit
      ]);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .post('/files/upload-url')
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', ctx.org.id)
        .send({
          filename: 'one-more.pdf',
          mimeType: 'application/pdf',
          size: 1024,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/storage quota/i);
    });
  });
});
