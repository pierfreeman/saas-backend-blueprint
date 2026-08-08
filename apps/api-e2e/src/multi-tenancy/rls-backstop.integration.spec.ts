/**
 * rls-backstop.integration.spec.ts
 *
 * Regression test for the Row-Level Security backstop itself — distinct
 * from tenant-isolation.integration.spec.ts, which tests that the
 * *application's own guards* correctly deny cross-org access. This file
 * proves the database-level backstop still holds even when application
 * code forgets to filter by orgId, independent of any guard/controller
 * logic.
 *
 * Reproduces the exact real bugs that motivated adding RLS in the first
 * place (see prisma/migrations/20260808120000_enable_row_level_security):
 *   - libs/jobs/.../job.repository.ts: markProcessing/markDone/markFailed/
 *     delete filter `where: { id: jobId }` only, no orgId.
 *   - libs/memberships/.../memberships.repository.ts: findById/update
 *     filter `where: { id }` only, no orgId.
 *
 * Uses `app.get(PrismaBusinessService)` — the app's own app_runtime-scoped
 * connection (not the admin bypass client from admin-db.helper.ts) — so
 * this genuinely exercises RLS as apps/api connects to Postgres in
 * production, not a superuser connection that would bypass it silently.
 */
import { INestApplication } from '@nestjs/common';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { getTestAdminPrisma } from '@test/utils/admin-db.helper';
import {
  PrismaBusinessService,
  JobStatus,
  runWithTenant,
} from '@libs/prisma-business';

describe('RLS backstop (integration)', () => {
  let app: INestApplication;
  let adminPrisma: PrismaBusinessService;
  let appPrisma: PrismaBusinessService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    adminPrisma = await getTestAdminPrisma();
    // The app's own DI-provided connection — app_runtime role, RLS-subject.
    appPrisma = app.get(PrismaBusinessService);
    await resetBusinessDb(adminPrisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  it('job.repository.ts pattern: findUnique by id alone cannot see another tenant\'s row, even with the real app connection', async () => {
    const ctxA = await seedFullOrg(adminPrisma, { orgName: 'RLS Backstop Org A' });
    const ctxB = await seedFullOrg(adminPrisma, { orgName: 'RLS Backstop Org B' });

    const ownerA = await adminPrisma.user.findUnique({
      where: { auth0Id: ctxA.owner.auth0Id },
    });

    const job = await runWithTenant(ctxA.org.id, () =>
      adminPrisma.job.create({
        data: {
          orgId: ctxA.org.id,
          userId: ownerA!.id,
          type: 'heavy_job',
          status: JobStatus.PENDING,
          payload: {},
        },
      }),
    );

    // Deliberately reproduce the bug: query by id ALONE, no orgId in the
    // where clause — exactly what job.repository.ts's markProcessing/
    // markDone/markFailed/delete methods do.
    const wrongOrgContext = await runWithTenant(ctxB.org.id, () =>
      appPrisma.job.findUnique({ where: { id: job.id } }),
    );
    expect(wrongOrgContext).toBeNull();

    const noContext = await appPrisma.job.findUnique({
      where: { id: job.id },
    });
    expect(noContext).toBeNull();

    // Sanity check: the row genuinely exists and IS visible with the
    // correct tenant context — proves the above aren't just always-empty.
    const correctOrgContext = await runWithTenant(ctxA.org.id, () =>
      appPrisma.job.findUnique({ where: { id: job.id } }),
    );
    expect(correctOrgContext?.id).toBe(job.id);
  });

  it('memberships.repository.ts pattern: findUnique by id alone cannot see another tenant\'s row', async () => {
    const ctxA = await seedFullOrg(adminPrisma, {
      orgName: 'RLS Backstop Membership Org A',
    });
    const ctxB = await seedFullOrg(adminPrisma, {
      orgName: 'RLS Backstop Membership Org B',
    });

    // ctxA.owner.membership is the row created by seedFullOrg for Org A's owner.
    const membershipId = ctxA.owner.membership.id;

    const wrongOrgContext = await runWithTenant(ctxB.org.id, () =>
      appPrisma.membership.findUnique({ where: { id: membershipId } }),
    );
    expect(wrongOrgContext).toBeNull();

    const noContext = await appPrisma.membership.findUnique({
      where: { id: membershipId },
    });
    expect(noContext).toBeNull();

    const correctOrgContext = await runWithTenant(ctxA.org.id, () =>
      appPrisma.membership.findUnique({ where: { id: membershipId } }),
    );
    expect(correctOrgContext?.id).toBe(membershipId);
  });

  it('concurrent requests for different orgs on the shared connection pool do not cross-contaminate', async () => {
    const ctxA = await seedFullOrg(adminPrisma, {
      orgName: 'RLS Backstop Concurrency Org A',
    });
    const ctxB = await seedFullOrg(adminPrisma, {
      orgName: 'RLS Backstop Concurrency Org B',
    });
    const ownerA = await adminPrisma.user.findUnique({
      where: { auth0Id: ctxA.owner.auth0Id },
    });
    const job = await runWithTenant(ctxA.org.id, () =>
      adminPrisma.job.create({
        data: {
          orgId: ctxA.org.id,
          userId: ownerA!.id,
          type: 'heavy_job',
          status: JobStatus.PENDING,
          payload: {},
        },
      }),
    );

    const [asOrgA, asOrgB] = await Promise.all([
      runWithTenant(ctxA.org.id, () =>
        appPrisma.job.findUnique({ where: { id: job.id } }),
      ),
      runWithTenant(ctxB.org.id, () =>
        appPrisma.job.findUnique({ where: { id: job.id } }),
      ),
    ]);

    expect(asOrgA?.id).toBe(job.id);
    expect(asOrgB).toBeNull();
  });
});
