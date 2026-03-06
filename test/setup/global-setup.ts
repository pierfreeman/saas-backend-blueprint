/**
 * Jest globalSetup — runs in its own Node.js process before all test suites.
 *
 * Responsibilities:
 *  1. Loads .env.test so migration commands use test database URLs.
 *  2. Runs Prisma migrations for both the business DB and legal audit DB.
 *
 * NOTE: This runs ONCE before any test file loads. It cannot share state with
 * test workers via module-level variables; use files or globalThis for that.
 */
import { execSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

module.exports = async function globalSetup() {
  // Load .env.test so migration commands have the correct DATABASE_URLs.
  // override: true is needed because NX pre-loads .env before running targets,
  // which would otherwise prevent the test values from taking effect.
  dotenv.config({
    path: path.join(process.cwd(), '.env.test'),
    override: true,
  });

  console.log('\n[global-setup] Running business DB migrations...');
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: 'inherit',
  });

  console.log('[global-setup] Running legal audit DB migrations...');
  execSync('npx prisma migrate deploy --schema=prisma/schema.legal.prisma', {
    cwd: process.cwd(),
    env: { ...process.env, PRISMA_LEGAL_SCHEMA: '1' },
    stdio: 'inherit',
  });

  console.log('[global-setup] Migrations complete.\n');
};
