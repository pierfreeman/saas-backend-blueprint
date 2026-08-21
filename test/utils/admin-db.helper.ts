/**
 * admin-db.helper.ts — Admin-scoped Prisma client for direct test fixture
 * setup and assertions.
 *
 * apps/api and apps/worker-a connect as the app_runtime Postgres role
 * (RLS-subject) — see prisma/migrations/20260808120000_enable_row_level_security
 * and libs/prisma-business. That's exactly what integration tests need in
 * order to prove RLS is enforced through real request/job paths.
 *
 * But test fixture setup (`createTestOrg`, inline `prisma.membership.create(...)`
 * in spec files) and result assertions (`prisma.activityLog.findMany(...)`)
 * are test *infrastructure*, not simulated end-user requests — they have no
 * ambient tenant context and legitimately need to read/write across
 * organizations. Reusing the app's own app_runtime-scoped
 * `app.get(PrismaBusinessService)` instance for that would mean every test
 * file has to fight RLS just to set up its fixtures.
 *
 * This module provides a *separate* PrismaBusinessService instance
 * connected as app_admin_runtime (BYPASSRLS) — the same role apps/admin-api
 * uses — for exactly that purpose. It is intentionally NOT the same
 * instance the app-under-test resolves via its own DI container, so RLS
 * keeps being genuinely exercised through supertest HTTP calls / worker
 * event dispatch, which still go through the app's own app_runtime
 * connection.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaBusinessService } from '@libs/prisma-business';

let instance: PrismaBusinessService | undefined;

export async function getTestAdminPrisma(): Promise<PrismaBusinessService> {
  if (instance) return instance;

  const connectionString =
    process.env['ADMIN_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
  const config = {
    get: (key: string) =>
      key === 'database.url' ? connectionString : undefined,
  } as unknown as ConfigService;

  instance = new PrismaBusinessService(config);
  await instance.onModuleInit();
  return instance;
}
