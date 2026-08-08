#!/usr/bin/env node
/**
 * migrate-test.js — Runs Prisma migrations against test databases.
 *
 * Loads .env.test before executing migrations so no external dotenv CLI is needed.
 * Usage: node scripts/migrate-test.js
 *        npm run test:migrate
 */
const { execSync } = require('child_process');
const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env.test'),
  override: true,
});

console.log('[migrate-test] Running business DB migrations...');
// Migrations (ALTER TABLE ... ENABLE ROW LEVEL SECURITY, CREATE POLICY) need
// the superuser/owner role — MIGRATE_DATABASE_URL, not the app_runtime-scoped
// DATABASE_URL that e2e test processes connect with.
const migrateDatabaseUrl =
  process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
execSync('npx prisma migrate deploy', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
  stdio: 'inherit',
});

console.log('[migrate-test] Provisioning app_runtime / app_admin_runtime role passwords...');
execSync('node scripts/provision-runtime-roles.mjs', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: migrateDatabaseUrl },
  stdio: 'inherit',
});

console.log('[migrate-test] Running legal audit DB migrations...');
execSync('npx prisma migrate deploy --config prisma.config.legal.ts', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PRISMA_LEGAL_SCHEMA: '1' },
  stdio: 'inherit',
});

console.log('[migrate-test] Done.');
