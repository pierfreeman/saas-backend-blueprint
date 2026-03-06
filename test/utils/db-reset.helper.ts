/**
 * db-reset.helper.ts — Wraps PrismaBusinessService.cleanDatabase() for tests.
 *
 * Deletes all rows from every business DB model. Safe to call in beforeAll/beforeEach
 * since cleanDatabase() throws if NODE_ENV=production.
 *
 * The legal audit DB is NOT cleaned — it is append-only by design. Use unique
 * orgId UUIDs per test suite to avoid assertion interference.
 */
import { PrismaBusinessService } from '@libs/prisma-business';

/**
 * Resets the business database by deleting all rows from every model.
 * Must be called with NODE_ENV=test (set via .env.test / load-env.ts).
 */
export async function resetBusinessDb(
  prisma: PrismaBusinessService,
): Promise<void> {
  await prisma.cleanDatabase();
}
