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
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: workspaceRoot,
    env: { ...process.env },
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
