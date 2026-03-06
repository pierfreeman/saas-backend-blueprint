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
execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env },
  stdio: 'inherit',
});

console.log('[migrate-test] Running legal audit DB migrations...');
execSync('npx prisma migrate deploy --config prisma.config.legal.ts', {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PRISMA_LEGAL_SCHEMA: '1' },
  stdio: 'inherit',
});

console.log('[migrate-test] Done.');
