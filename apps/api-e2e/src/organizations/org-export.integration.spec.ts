/**
 * org-export.integration.spec.ts
 *
 * Validates the full org export workflow end-to-end:
 *
 *  1. Create org via API (triggers legal audit entry)
 *  2. Seed additional data: extra memberships, activity log entries, jobs
 *  3. POST /organizations/:id/export (OWNER/ADMIN token)
 *  4. GET /organizations/:id/exports/:exportId
 *  5. Assert job created, export status tracked, legal audit preserved
 *  6. Test pagination with GET /organizations/:id/exports
 *  7. Test permission restrictions (READ_ONLY cannot export)
 *  8. Test IDOR protection (cannot access other org's exports)
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import {
  createTestOrg,
  createTestUser,
  createTestMembership,
  seedFullOrg,
} from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { PrismaLegalService } from '@libs/prisma-legal';
import { ExportStatus, JobStatus, MembershipRole } from '@libs/prisma-business';

/** Fire-and-forget logging is async — wait briefly before asserting on log tables. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Org Export Workflow (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let legalPrisma: PrismaLegalService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    legalPrisma = app.get(PrismaLegalService);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  it('creates export request with job and tracks status — preserves legal audit', async () => {
    // ── Step 1: Create org via API to trigger legal audit entry ────────────
    const ownerAuth0Id = 'auth0|export-owner-001';
    const ownerToken = generateTestToken({ sub: ownerAuth0Id });

    const createRes = await agent
      .post('/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Org To Export' });

    expect(createRes.status).toBe(201);
    const orgId = createRes.body.id as string;

    // Allow fire-and-forget legal audit to commit
    await sleep(300);

    // ── Step 2: Seed additional data directly in the DB ────────────────────
    const ownerUser = await prisma.user.findUnique({
      where: { auth0Id: ownerAuth0Id },
    });
    expect(ownerUser).not.toBeNull();

    // Extra member
    const extraUser = await createTestUser(prisma);
    await createTestMembership(
      prisma,
      extraUser.id,
      orgId,
      MembershipRole.MEMBER,
    );

    // Activity log entries
    await prisma.activityLog.createMany({
      data: [
        {
          orgId,
          actorId: ownerUser!.id,
          action: 'test.event.one',
          actorRole: 'OWNER',
        },
        {
          orgId,
          actorId: ownerUser!.id,
          action: 'test.event.two',
          actorRole: 'OWNER',
        },
      ],
    });

    // Jobs
    await prisma.job.createMany({
      data: [
        {
          orgId,
          userId: ownerUser!.id,
          type: 'test_job',
          status: JobStatus.DONE,
          payload: {},
        },
        {
          orgId,
          userId: ownerUser!.id,
          type: 'test_job',
          status: JobStatus.PENDING,
          payload: {},
        },
      ],
    });

    // ── Step 3: Request export (OWNER, HTTP 202) ───────────────────────────
    const exportRes = await agent
      .post(`/organizations/${orgId}/export`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(exportRes.status).toBe(202);
    expect(exportRes.body).toHaveProperty('exportId');
    const exportId = exportRes.body.exportId as string;

    // Allow fire-and-forget legal audit for export request to commit
    await sleep(300);

    // ── Step 4: Verify export record created with PENDING status ───────────
    const exportRecord = await prisma.orgExport.findUnique({
      where: { id: exportId },
      include: { job: true },
    });

    expect(exportRecord).not.toBeNull();
    expect(exportRecord!.orgId).toBe(orgId);
    expect(exportRecord!.requestedByUserId).toBe(ownerUser!.id);
    expect(exportRecord!.status).toBe(ExportStatus.PENDING);
    expect(exportRecord!.job).not.toBeNull();
    expect(exportRecord!.job!.type).toBe('org.export.requested');
    expect(exportRecord!.job!.status).toBe(JobStatus.PENDING);

    // ── Step 5: Get export status via API ──────────────────────────────────
    const getRes = await agent
      .get(`/organizations/${orgId}/exports/${exportId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      id: exportId,
      status: ExportStatus.PENDING,
      orgId,
      requestedByUserId: ownerUser!.id,
    });

    // ── Step 6: Legal audit DB — export request event PRESERVED ────────────
    const legalEvents = await legalPrisma.auditEvent.findMany({
      where: { orgId, eventType: 'org.export.requested' },
    });

    expect(legalEvents.length).toBeGreaterThanOrEqual(1);
    expect(legalEvents[0].eventType).toBe('org.export.requested');
    expect(legalEvents[0].userId).toBe(ownerUser!.id);
  });

  it('allows ADMIN to request export', async () => {
    const ctx = await seedFullOrg(prisma, { withAdmin: true });
    const adminToken = generateTestToken({ sub: ctx.admin!.auth0Id });

    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(exportRes.status).toBe(202);
    expect(exportRes.body).toHaveProperty('exportId');
  });

  it('returns 403 when READ_ONLY tries to request export', async () => {
    const ctx = await seedFullOrg(prisma, { withReadOnly: true });
    const readOnlyToken = generateTestToken({ sub: ctx.readOnly!.auth0Id });

    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${readOnlyToken}`);

    expect(exportRes.status).toBe(403);
  });

  it('returns 403 when MEMBER tries to request export', async () => {
    const ctx = await seedFullOrg(prisma, { withMember: true });
    const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${memberToken}`);

    expect(exportRes.status).toBe(403);
  });

  it('returns 404 when requesting export for non-existent org', async () => {
    const token = generateTestToken({ sub: 'auth0|export-404-user' });
    const fakeId = '00000000-0000-0000-0000-000000000099';

    const exportRes = await agent
      .post(`/organizations/${fakeId}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(404);
  });

  it('prevents IDOR: cannot access exports from other organizations', async () => {
    // Create org A with export
    const ctxA = await seedFullOrg(prisma, { orgName: 'Org A' });
    const tokenA = generateTestToken({ sub: ctxA.owner.auth0Id });

    const exportResA = await agent
      .post(`/organizations/${ctxA.org.id}/export`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(exportResA.status).toBe(202);
    const exportIdA = exportResA.body.exportId as string;

    // Create org B
    const ctxB = await seedFullOrg(prisma, { orgName: 'Org B' });
    const tokenB = generateTestToken({ sub: ctxB.owner.auth0Id });

    // Try to access org A's export using org B's credentials
    const getRes = await agent
      .get(`/organizations/${ctxB.org.id}/exports/${exportIdA}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(getRes.status).toBe(404);
  });

  it('lists exports for organization with pagination', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Create multiple exports
    const export1Res = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);
    expect(export1Res.status).toBe(202);

    const export2Res = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);
    expect(export2Res.status).toBe(202);

    const export3Res = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);
    expect(export3Res.status).toBe(202);

    // List all exports
    const listRes = await agent
      .get(`/organizations/${ctx.org.id}/exports`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThanOrEqual(3);

    // Verify exports are ordered by creation date descending (most recent first)
    const timestamps = listRes.body.map((e: any) =>
      new Date(e.createdAt).getTime(),
    );
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });

  it('lists exports with pagination parameters', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Create 5 exports
    for (let i = 0; i < 5; i++) {
      await agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`);
    }

    // Get first page (limit 2)
    const page1Res = await agent
      .get(`/organizations/${ctx.org.id}/exports?limit=2&offset=0`)
      .set('Authorization', `Bearer ${token}`);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.length).toBe(2);

    // Get second page (limit 2, offset 2)
    const page2Res = await agent
      .get(`/organizations/${ctx.org.id}/exports?limit=2&offset=2`)
      .set('Authorization', `Bearer ${token}`);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.length).toBe(2);

    // Ensure different exports returned
    const page1Ids = page1Res.body.map((e: any) => e.id);
    const page2Ids = page2Res.body.map((e: any) => e.id);
    expect(page1Ids).not.toEqual(page2Ids);
  });

  it('returns empty list when org has no exports', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    const listRes = await agent
      .get(`/organizations/${ctx.org.id}/exports`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBe(0);
  });

  it('returns 404 when getting export status for non-existent export', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });
    const fakeExportId = '00000000-0000-0000-0000-000000000099';

    const getRes = await agent
      .get(`/organizations/${ctx.org.id}/exports/${fakeExportId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(404);
  });

  it('handles DELETED organization gracefully', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Mark org as DELETED
    await prisma.organization.update({
      where: { id: ctx.org.id },
      data: { status: 'DELETED' },
    });

    // Try to request export
    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(400);
  });

  it('allows SUSPENDED organization to be exported', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Mark org as SUSPENDED
    await prisma.organization.update({
      where: { id: ctx.org.id },
      data: { status: 'SUSPENDED' },
    });

    // Request export
    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(202);
    expect(exportRes.body).toHaveProperty('exportId');
  });

  it('allows PENDING_DELETION organization to be exported', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Mark org as PENDING_DELETION
    await prisma.organization.update({
      where: { id: ctx.org.id },
      data: { status: 'PENDING_DELETION' },
    });

    // Request export
    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(202);
    expect(exportRes.body).toHaveProperty('exportId');
  });

  it('includes export metadata in response', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(202);
    const exportId = exportRes.body.exportId;

    const getRes = await agent
      .get(`/organizations/${ctx.org.id}/exports/${exportId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toHaveProperty('id');
    expect(getRes.body).toHaveProperty('status');
    expect(getRes.body).toHaveProperty('orgId');
    expect(getRes.body).toHaveProperty('requestedByUserId');
    expect(getRes.body).toHaveProperty('createdAt');
    expect(getRes.body).toHaveProperty('jobId');
  });

  it('does not expose internal job details in export response', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(202);
    const exportId = exportRes.body.exportId;

    const getRes = await agent
      .get(`/organizations/${ctx.org.id}/exports/${exportId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(getRes.status).toBe(200);
    // Should have jobId reference but not full job object with payload
    expect(getRes.body).toHaveProperty('jobId');
    expect(getRes.body).not.toHaveProperty('job.payload');
  });

  it('tracks legal audit events for export lifecycle', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Request export
    const exportRes = await agent
      .post(`/organizations/${ctx.org.id}/export`)
      .set('Authorization', `Bearer ${token}`);

    expect(exportRes.status).toBe(202);

    // Allow fire-and-forget legal audit to commit
    await sleep(300);

    // Verify legal audit event exists
    const legalEvents = await legalPrisma.auditEvent.findMany({
      where: {
        orgId: ctx.org.id,
        eventType: 'org.export.requested',
      },
    });

    expect(legalEvents.length).toBeGreaterThanOrEqual(1);
    const exportEvent = legalEvents[0];
    expect(exportEvent.userId).toBe(ctx.owner.user.id);
    expect(exportEvent.eventType).toBe('org.export.requested');
    expect(exportEvent.orgId).toBe(ctx.org.id);
  });

  it('handles multiple concurrent export requests for same org', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Request multiple exports concurrently
    const [res1, res2, res3] = await Promise.all([
      agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`),
      agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`),
      agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`),
    ]);

    // All should succeed
    expect(res1.status).toBe(202);
    expect(res2.status).toBe(202);
    expect(res3.status).toBe(202);

    // All should have different export IDs
    const exportIds = [
      res1.body.exportId,
      res2.body.exportId,
      res3.body.exportId,
    ];
    const uniqueIds = new Set(exportIds);
    expect(uniqueIds.size).toBe(3);
  });

  it('returns 404 when listing exports for non-existent org', async () => {
    const token = generateTestToken({ sub: 'auth0|export-list-404' });
    const fakeId = '00000000-0000-0000-0000-000000000099';

    const listRes = await agent
      .get(`/organizations/${fakeId}/exports`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(404);
  });

  it('respects pagination limits correctly', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Create 10 exports
    for (let i = 0; i < 10; i++) {
      await agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`);
    }

    // Request with limit=3
    const listRes = await agent
      .get(`/organizations/${ctx.org.id}/exports?limit=3`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(3);
  });

  it('uses default pagination when parameters not provided', async () => {
    const ctx = await seedFullOrg(prisma);
    const token = generateTestToken({ sub: ctx.owner.auth0Id });

    // Create 15 exports
    for (let i = 0; i < 15; i++) {
      await agent
        .post(`/organizations/${ctx.org.id}/export`)
        .set('Authorization', `Bearer ${token}`);
    }

    // Request without pagination params (should use defaults)
    const listRes = await agent
      .get(`/organizations/${ctx.org.id}/exports`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    // Default limit is typically 10-20
    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body.length).toBeLessThanOrEqual(20);
  });
});
