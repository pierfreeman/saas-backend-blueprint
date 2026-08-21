#!/usr/bin/env node
/**
 * verify-rls-policies.mjs — Asserts every org-scoped table has Row-Level
 * Security enabled and at least one policy defined.
 *
 * "org-scoped" is discovered dynamically from information_schema.columns
 * (any table with an `org_id` column), plus a fixed allowlist of tables
 * that are tenant-scoped through a foreign key rather than their own
 * org_id column (see prisma/migrations/20260808120000_enable_row_level_security).
 *
 * This exists so a future Prisma model with an org_id column can't be added
 * without also shipping its RLS policy — CI fails loudly instead of the gap
 * being discovered as a cross-tenant data leak.
 *
 * Usage: node scripts/verify-rls-policies.mjs
 * Requires: DATABASE_URL env var pointing at a migrated database.
 */
import { Client } from 'pg';

// Tenant-scoped through a parent FK (events.org_id), not their own column.
// Keep this list in sync with prisma/migrations/20260808120000_enable_row_level_security.
const FK_SCOPED_TABLES = [
  { schema: 'public', table: 'event_attendees' },
  { schema: 'public', table: 'event_occurrence_attendees' },
  { schema: 'public', table: 'event_exceptions' },
];

// Tenant root: scoped by its own `id`, not an org_id column.
const ROOT_SCOPED_TABLES = [{ schema: 'public', table: 'organizations' }];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[verify-rls-policies] DATABASE_URL is not set.');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows: orgIdTables } = await client.query(`
      SELECT table_schema AS schema, table_name AS table
      FROM information_schema.columns
      WHERE column_name = 'org_id'
      ORDER BY table_schema, table_name
    `);

    const tablesToCheck = [
      ...orgIdTables,
      ...FK_SCOPED_TABLES,
      ...ROOT_SCOPED_TABLES,
    ];

    if (tablesToCheck.length === 0) {
      console.error(
        '[verify-rls-policies] No org_id columns found — did migrations run?',
      );
      process.exit(1);
    }

    const failures = [];

    for (const { schema, table } of tablesToCheck) {
      const { rows } = await client.query(
        `SELECT relrowsecurity FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema, table],
      );

      if (rows.length === 0) {
        failures.push(`${schema}.${table}: table not found`);
        continue;
      }

      if (!rows[0].relrowsecurity) {
        failures.push(`${schema}.${table}: ROW LEVEL SECURITY not enabled`);
        continue;
      }

      const { rows: policyRows } = await client.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = $1 AND tablename = $2`,
        [schema, table],
      );

      if (policyRows.length === 0) {
        failures.push(`${schema}.${table}: RLS enabled but no policy defined`);
      }
    }

    if (failures.length > 0) {
      console.error('[verify-rls-policies] FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
      process.exit(1);
    }

    console.log(
      `[verify-rls-policies] OK — ${tablesToCheck.length} tenant-scoped table(s) have RLS + policies.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[verify-rls-policies] Unexpected error:', err);
  process.exit(1);
});
