#!/usr/bin/env node
/**
 * provision-runtime-roles.mjs — Sets LOGIN passwords on the app_runtime and
 * app_admin_runtime Postgres roles (created NOLOGIN by the
 * 20260808120000_enable_row_level_security migration).
 *
 * Role passwords can't live in a migration file (migrations are committed
 * to git), so this runs as a separate, idempotent step immediately after
 * `prisma migrate deploy`/`migrate dev`, using the same superuser
 * connection (DATABASE_URL) migrations already run as.
 *
 * Safe to run every deploy: ALTER ROLE ... PASSWORD is idempotent and just
 * (re)syncs the password to the current env var value.
 *
 * Usage: node scripts/provision-runtime-roles.mjs
 * Requires: DATABASE_URL (superuser/migration role),
 *           APP_RUNTIME_DB_PASSWORD, APP_ADMIN_RUNTIME_DB_PASSWORD
 */
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const appRuntimePassword = process.env.APP_RUNTIME_DB_PASSWORD;
  const appAdminRuntimePassword = process.env.APP_ADMIN_RUNTIME_DB_PASSWORD;

  if (!connectionString) {
    console.error('[provision-runtime-roles] DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!appRuntimePassword || !appAdminRuntimePassword) {
    console.error(
      '[provision-runtime-roles] APP_RUNTIME_DB_PASSWORD and APP_ADMIN_RUNTIME_DB_PASSWORD must both be set.',
    );
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // ALTER ROLE does not support bind parameters for the password literal;
    // server-side format(%L, ...) is used instead of naive string
    // interpolation to avoid SQL injection via the password value.
    const { rows: runtimeSql } = await client.query(
      `SELECT format('ALTER ROLE app_runtime WITH LOGIN PASSWORD %L', $1::text) AS sql`,
      [appRuntimePassword],
    );
    await client.query(runtimeSql[0].sql);

    const { rows: adminSql } = await client.query(
      `SELECT format('ALTER ROLE app_admin_runtime WITH LOGIN PASSWORD %L', $1::text) AS sql`,
      [appAdminRuntimePassword],
    );
    await client.query(adminSql[0].sql);

    console.log(
      '[provision-runtime-roles] OK — app_runtime and app_admin_runtime passwords synced.',
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[provision-runtime-roles] Unexpected error:', err);
  process.exit(1);
});
