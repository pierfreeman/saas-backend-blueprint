#!/usr/bin/env node
/**
 * migrate-dev.cjs — Runs Prisma migrations against the local dev databases
 * and provisions the app_runtime / app_admin_runtime role passwords.
 *
 * Loads .env before executing migrations. Uses `prisma migrate dev` (not
 * `deploy`) so schema drift can be interactively resolved locally, same as
 * the previous `dev:migrate` script.
 *
 * Usage: node scripts/migrate-dev.cjs
 *        npm run dev:migrate
 */
const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: true,
});

console.log('[migrate-dev] Running business DB migrations...');
// Migrations (ALTER TABLE ... ENABLE ROW LEVEL SECURITY, CREATE POLICY) need
// the superuser/owner role — MIGRATE_DATABASE_URL, not the app_runtime-scoped
// DATABASE_URL that `nx serve api`/`nx serve worker-a` connect with.
const migrateDatabaseUrl =
  process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
execSync('npx prisma migrate dev', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
  stdio: 'inherit',
});

console.log(
  '[migrate-dev] Provisioning app_runtime / app_admin_runtime role passwords...',
);
execSync('node scripts/provision-runtime-roles.mjs', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
  stdio: 'inherit',
});

console.log('[migrate-dev] Running legal audit DB migrations...');
execSync('npx prisma migrate dev --config prisma.config.legal.ts', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env },
  stdio: 'inherit',
});

console.log('[migrate-dev] Done.');
