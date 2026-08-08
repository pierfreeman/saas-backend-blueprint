import { execSync } from 'child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';

// Workspace root is two levels up from test/setup/global-setup.ts
// This avoids relying on process.cwd(), which differs between the @nx/vitest
// executor (workspace root) and the inferred "test" target (project dir).
const workspaceRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export default async function globalSetup() {
  // Load .env.test so migration commands have the correct DATABASE_URLs.
  // override: true is needed because NX pre-loads .env before running targets,
  // which would otherwise prevent the test values from taking effect.
  dotenv.config({
    path: path.join(workspaceRoot, '.env.test'),
    override: true,
  });

  console.log('\n[global-setup] Running business DB migrations...');
  // Schema migrations (ALTER TABLE ... ENABLE ROW LEVEL SECURITY, CREATE
  // POLICY) need the superuser/owner role — MIGRATE_DATABASE_URL, not the
  // app_runtime/app_admin_runtime-scoped DATABASE_URL the app under test
  // connects with. See prisma/migrations/20260808120000_enable_row_level_security.
  const migrateDatabaseUrl =
    process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
    stdio: 'inherit',
  });

  console.log(
    '[global-setup] Provisioning app_runtime / app_admin_runtime role passwords...',
  );
  execSync('node scripts/provision-runtime-roles.mjs', {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
    stdio: 'inherit',
  });

  console.log('[global-setup] Running legal audit DB migrations...');
  execSync('npx prisma migrate deploy --config prisma.config.legal.ts', {
    cwd: workspaceRoot,
    env: { ...process.env, PRISMA_LEGAL_SCHEMA: '1' },
    stdio: 'inherit',
  });

  console.log('[global-setup] Migrations complete.\n');
}
