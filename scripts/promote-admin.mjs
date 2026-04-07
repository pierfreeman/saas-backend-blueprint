#!/usr/bin/env node
/**
 * promote-admin.mjs — Grants or revokes system-admin access for a user by email.
 *
 * Uses the DATABASE_URL from the local .env file (or the environment).
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   node scripts/promote-admin.mjs --email user@example.com            # promote
 *   node scripts/promote-admin.mjs --email user@example.com --revoke   # demote
 *
 * Requires the Prisma client to be generated first:
 *   npx prisma generate
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Load .env (if present) ─────────────────────────────────────────────────
const envPath = resolve(root, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    const value =
      raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    if (!process.env[key]) process.env[key] = value;
  }
}

// ── Parse args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const emailIdx = args.indexOf('--email');
const email = emailIdx !== -1 ? args[emailIdx + 1] : null;
const revoke = args.includes('--revoke');

if (!email) {
  console.error(
    'Usage: node scripts/promote-admin.mjs --email <email> [--revoke]',
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Check your .env file.');
  process.exit(1);
}

// ── Connect to DB via pg (avoids needing the TypeScript Prisma client) ────
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();

  const { rows } = await client.query(
    'SELECT id, email, is_system_admin AS "isSystemAdmin" FROM users WHERE email = $1',
    [email.toLowerCase()],
  );

  if (rows.length === 0) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  const user = rows[0];
  const target = !revoke;

  if (user.isSystemAdmin === target) {
    console.log(
      `No change needed — user "${email}" isSystemAdmin is already ${target}.`,
    );
    return;
  }

  await client.query('UPDATE users SET is_system_admin = $1 WHERE id = $2', [
    target,
    user.id,
  ]);

  const action = target ? 'promoted to' : 'demoted from';
  console.log(`✓ User "${email}" (${user.id}) ${action} system-admin.`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => client.end());
