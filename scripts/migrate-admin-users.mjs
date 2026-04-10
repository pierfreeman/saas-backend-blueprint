#!/usr/bin/env node
/**
 * migrate-admin-users.mjs
 *
 * ONE-TIME migration script.
 *
 * Reads all users with `is_system_admin = true` from the business DB,
 * creates a corresponding account in Auth0's Admin-Users-DB connection,
 * and inserts an AdminUser record in the legal DB with the new Auth0 user ID.
 *
 * IMPORTANT: Run this ONCE after deploying the admin-identity schema migration.
 * Do NOT re-run — it will skip users whose email already exists in Auth0.
 *
 * Usage:
 *   node scripts/migrate-admin-users.mjs [--dry-run]
 *
 * Required env vars:
 *   DATABASE_URL
 *   LEGAL_AUDIT_DATABASE_URL
 *   ADMIN_AUTH0_DOMAIN
 *   ADMIN_AUTH0_M2M_CLIENT_ID
 *   ADMIN_AUTH0_M2M_CLIENT_SECRET
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaClient as BusinessPrisma } from '@prisma/client';
import { PrismaClient as LegalPrisma } from '../libs/prisma-legal/src/generated/prisma/index.js';

const { values } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false } },
});

const isDryRun = values['dry-run'];

// ─── Env validation ───────────────────────────────────────────────────────────

const REQUIRED = [
  'DATABASE_URL',
  'LEGAL_AUDIT_DATABASE_URL',
  'ADMIN_AUTH0_DOMAIN',
  'ADMIN_AUTH0_M2M_CLIENT_ID',
  'ADMIN_AUTH0_M2M_CLIENT_SECRET',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const AUTH0_DOMAIN = process.env['ADMIN_AUTH0_DOMAIN'];
const M2M_CLIENT_ID = process.env['ADMIN_AUTH0_M2M_CLIENT_ID'];
const M2M_CLIENT_SECRET = process.env['ADMIN_AUTH0_M2M_CLIENT_SECRET'];
const DB_CONNECTION = 'Admin-Users-DB';

// ─── Auth0 helpers ────────────────────────────────────────────────────────────

let _managementToken = null;

async function getManagementToken() {
  if (_managementToken) return _managementToken;

  const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: M2M_CLIENT_ID,
      client_secret: M2M_CLIENT_SECRET,
      audience: `https://${AUTH0_DOMAIN}/api/v2/`,
    }),
  });

  if (!res.ok) throw new Error(`Auth0 token error: ${await res.text()}`);
  _managementToken = (await res.json()).access_token;
  return _managementToken;
}

async function auth0Request(path, options = {}) {
  const token = await getManagementToken();
  const res = await fetch(`https://${AUTH0_DOMAIN}/api/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  const body = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    throw new Error(`Auth0 API [${res.status}]: ${JSON.stringify(body)}`);
  }

  return body;
}

/** Returns existing Auth0 user or null — avoids duplicates on re-run. */
async function findAuth0UserByEmail(email) {
  const users = await auth0Request(
    `/users-by-email?email=${encodeURIComponent(email)}`,
  );
  return (
    users.find((u) => u.identities?.[0]?.connection === DB_CONNECTION) ?? null
  );
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const businessPrisma = new BusinessPrisma({
    datasourceUrl: process.env['DATABASE_URL'],
  });
  const legalPrisma = new LegalPrisma({
    datasourceUrl: process.env['LEGAL_AUDIT_DATABASE_URL'],
  });

  try {
    // 1. Fetch all system admins from business DB
    const systemAdmins = await businessPrisma.user.findMany({
      where: { isSystemAdmin: true },
      select: { id: true, email: true, name: true, auth0Id: true },
    });

    console.log(`Found ${systemAdmins.length} system admin(s) to migrate.\n`);

    if (!systemAdmins.length) {
      console.log('Nothing to do.');
      return;
    }

    if (isDryRun) {
      console.log('DRY RUN — no changes will be made.\n');
    }

    const results = { created: 0, skipped: 0, failed: 0 };

    for (const admin of systemAdmins) {
      console.log(`Processing ${admin.email} ...`);

      try {
        // 2. Check if already migrated in legal DB
        const existing = await legalPrisma.adminUser.findFirst({
          where: { email: admin.email },
        });

        if (existing) {
          console.log(`  SKIP — already in legal DB (id=${existing.id})`);
          results.skipped++;
          continue;
        }

        // 3. Find or create in Auth0 Admin-Users-DB
        let auth0User = await findAuth0UserByEmail(admin.email);

        if (auth0User) {
          console.log(`  Auth0 user already exists: ${auth0User.user_id}`);
        } else if (!isDryRun) {
          auth0User = await auth0Request('/users', {
            method: 'POST',
            body: JSON.stringify({
              email: admin.email,
              name: admin.name ?? admin.email,
              connection: DB_CONNECTION,
              password: generateTempPassword(),
              email_verified: true, // migrated users — email already verified
            }),
          });
          console.log(`  Auth0 user created: ${auth0User.user_id}`);

          // Trigger password-reset so they set a new password on first admin login
          await auth0Request('/tickets/password-change', {
            method: 'POST',
            body: JSON.stringify({
              user_id: auth0User.user_id,
              mark_email_as_verified: true,
            }),
          });
          console.log(`  Password-reset email sent.`);
        } else {
          console.log(
            `  DRY RUN — would create Auth0 user and insert AdminUser record.`,
          );
          results.created++;
          continue;
        }

        // 4. Insert AdminUser record in legal DB
        if (!isDryRun) {
          const adminUser = await legalPrisma.adminUser.create({
            data: {
              auth0Id: auth0User.user_id,
              email: admin.email,
              displayName: admin.name ?? null,
            },
          });
          console.log(`  Legal DB record created: id=${adminUser.id}`);
        }

        results.created++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        results.failed++;
      }
    }

    console.log(`\n─────────────────────────────────────`);
    console.log(`Migration complete:`);
    console.log(`  Created : ${results.created}`);
    console.log(`  Skipped : ${results.skipped}`);
    console.log(`  Failed  : ${results.failed}`);
    if (results.failed) process.exit(1);
  } finally {
    await businessPrisma.$disconnect();
    await legalPrisma.$disconnect();
  }
})();
