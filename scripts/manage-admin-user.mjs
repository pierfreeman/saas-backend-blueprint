#!/usr/bin/env node
/**
 * manage-admin-user.mjs
 *
 * CLI tool for managing admin users in the SaaS Admin Portal.
 * Interacts with both the Auth0 Management API (Admin-Users-DB connection)
 * and the Prisma legal database (admin_users table).
 *
 * Usage:
 *   node scripts/manage-admin-user.mjs --create  --email admin@example.com [--name "Display Name"]
 *   node scripts/manage-admin-user.mjs --disable --email admin@example.com
 *   node scripts/manage-admin-user.mjs --enable  --email admin@example.com
 *   node scripts/manage-admin-user.mjs --reset-password --email admin@example.com
 *   node scripts/manage-admin-user.mjs --list
 *
 * Required env vars (set in .env or shell):
 *   LEGAL_AUDIT_DATABASE_URL
 *   ADMIN_AUTH0_DOMAIN
 *   ADMIN_AUTH0_M2M_CLIENT_ID
 *   ADMIN_AUTH0_M2M_CLIENT_SECRET
 */

import 'dotenv/config';
import { parseArgs } from 'node:util';
import pg from 'pg';
const { Client: PgClient } = pg;

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    create: { type: 'boolean', default: false },
    disable: { type: 'boolean', default: false },
    enable: { type: 'boolean', default: false },
    'reset-password': { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
    email: { type: 'string' },
    name: { type: 'string' },
  },
  strict: true,
});

// ─── Env validation ───────────────────────────────────────────────────────────

if (!process.env['LEGAL_AUDIT_DATABASE_URL']) {
  console.error('Missing required env var: LEGAL_AUDIT_DATABASE_URL');
  process.exit(1);
}

// Auth0 vars are required for all commands except --list
if (!values.list) {
  for (const key of [
    'ADMIN_AUTH0_DOMAIN',
    'ADMIN_AUTH0_M2M_CLIENT_ID',
    'ADMIN_AUTH0_M2M_CLIENT_SECRET',
  ]) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }
}

const AUTH0_DOMAIN = process.env['ADMIN_AUTH0_DOMAIN'];
const M2M_CLIENT_ID = process.env['ADMIN_AUTH0_M2M_CLIENT_ID'];
const M2M_CLIENT_SECRET = process.env['ADMIN_AUTH0_M2M_CLIENT_SECRET'];
const DB_CONNECTION = 'Admin-Users-DB'; // The dedicated admin Auth0 connection

// ─── Auth0 Management API helpers ─────────────────────────────────────────────

async function getManagementToken() {
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get management token: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
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
    throw new Error(`Auth0 API error [${res.status}]: ${JSON.stringify(body)}`);
  }

  return body;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function createAdminUser(email, displayName) {
  console.log(`Creating admin user: ${email} ...`);

  let userId;

  // 1. Try to create in Auth0; if user already exists (409), unblock and reuse
  try {
    const auth0User = await auth0Request('/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        name: displayName ?? email,
        connection: DB_CONNECTION,
        password: generateTempPassword(),
        email_verified: false,
        verify_email: true,
      }),
    });
    userId = auth0User.user_id;
    console.log(`  Auth0 user created: ${userId}`);
  } catch (err) {
    if (!err.message.includes('409')) throw err;

    console.log(`  User already exists in Auth0. Fetching current state ...`);
    const existing = await auth0Request(
      `/users-by-email?email=${encodeURIComponent(email)}&connection=${DB_CONNECTION}`,
    );
    if (!existing.length)
      throw new Error('409 conflict but user not found by email.');
    userId = existing[0].user_id;

    if (existing[0].blocked) {
      await auth0Request(`/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ blocked: false }),
      });
      console.log(`  User was blocked — re-enabled: ${userId}`);
    } else {
      console.log(`  User already active: ${userId}`);
    }
  }

  // 2. Trigger password-reset email so the admin can set their own password
  // user_id is sufficient — connection_id is not required when user_id is provided
  await auth0Request('/tickets/password-change', {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      mark_email_as_verified: true,
      includeEmailInRedirect: true,
    }),
  });

  console.log(`  Password-reset email triggered.`);
  console.log(`  Done — admin user ${email} ready. User ID: ${userId}`);
}

async function disableAdminUser(email) {
  console.log(`Disabling admin user: ${email} ...`);

  const users = await auth0Request(
    `/users-by-email?email=${encodeURIComponent(email)}&connection=${DB_CONNECTION}`,
  );

  if (!users.length) {
    console.error(`No admin user found with email: ${email}`);
    process.exit(1);
  }

  const userId = users[0].user_id;

  await auth0Request(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked: true }),
  });

  console.log(`  User ${userId} blocked in Auth0.`);

  // Also check presence in legal DB if the record exists
  const db = new PgClient({
    connectionString: process.env['LEGAL_AUDIT_DATABASE_URL'],
  });
  await db.connect();
  try {
    const { rows } = await db.query(
      'SELECT id FROM admin_users WHERE email = $1',
      [email.toLowerCase()],
    );
    if (rows.length) {
      console.log(`  AdminUser found in legal DB: ${rows[0].id}`);
    } else {
      console.log(
        `  No AdminUser record in legal DB yet (user has not logged in).`,
      );
    }
  } finally {
    await db.end();
  }
}

async function enableAdminUser(email) {
  console.log(`Enabling admin user: ${email} ...`);

  const users = await auth0Request(
    `/users-by-email?email=${encodeURIComponent(email)}&connection=${DB_CONNECTION}`,
  );

  if (!users.length) {
    console.error(`No admin user found with email: ${email}`);
    process.exit(1);
  }

  const userId = users[0].user_id;

  if (!users[0].blocked) {
    console.log(`  User ${userId} is already active — nothing to do.`);
    return;
  }

  await auth0Request(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ blocked: false }),
  });

  console.log(`  User ${userId} unblocked in Auth0.`);
}

async function resetPassword(email) {
  console.log(`Sending password-reset email to: ${email} ...`);

  await auth0Request('/dbconnections/change_password', {
    method: 'POST',
    body: JSON.stringify({
      client_id: M2M_CLIENT_ID,
      email,
      connection: DB_CONNECTION,
    }),
  });

  console.log(`  Password-reset email sent.`);
}

async function listAdminUsers() {
  const db = new PgClient({
    connectionString: process.env['LEGAL_AUDIT_DATABASE_URL'],
  });
  await db.connect();
  try {
    const { rows } = await db.query(
      'SELECT id, email, auth0_id, created_at FROM admin_users ORDER BY created_at ASC',
    );

    if (!rows.length) {
      console.log(
        'No admin users found in the legal DB (none have logged in yet).',
      );
      return;
    }

    console.log(`\nAdmin users (${rows.length}):\n`);
    for (const u of rows) {
      console.log(`  ${u.email.padEnd(40)} id=${u.id}  auth0Id=${u.auth0_id}`);
    }
  } finally {
    await db.end();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateTempPassword() {
  // Generates a cryptographically random 24-char password that satisfies Auth0's
  // complexity requirements. The user will reset this on first login.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

(async () => {
  try {
    if (values.create) {
      if (!values.email) {
        console.error('--email is required for --create');
        process.exit(1);
      }
      await createAdminUser(values.email, values.name);
    } else if (values.disable) {
      if (!values.email) {
        console.error('--email is required for --disable');
        process.exit(1);
      }
      await disableAdminUser(values.email);
    } else if (values.enable) {
      if (!values.email) {
        console.error('--email is required for --enable');
        process.exit(1);
      }
      await enableAdminUser(values.email);
    } else if (values['reset-password']) {
      if (!values.email) {
        console.error('--email is required for --reset-password');
        process.exit(1);
      }
      await resetPassword(values.email);
    } else if (values.list) {
      await listAdminUsers();
    } else {
      console.error(`
Usage:
  node scripts/manage-admin-user.mjs --create  --email <email> [--name <name>]
  node scripts/manage-admin-user.mjs --disable --email <email>
  node scripts/manage-admin-user.mjs --enable  --email <email>
  node scripts/manage-admin-user.mjs --reset-password --email <email>
  node scripts/manage-admin-user.mjs --list
      `);
      process.exit(1);
    }
  } catch (err) {
    console.error('\nError:', err.message);
    process.exit(1);
  }
})();
