import { defineWorkspace } from 'vitest/config';

/**
 * Vitest workspace configuration — lists every project that has tests.
 * Each project's own vitest.config.ts holds per-project settings
 * (environment, coverage paths, thresholds, etc.).
 * Run all unit tests from the root with: npx vitest run
 * Run a specific project:                npx vitest run --project billing
 */
export default defineWorkspace([
  // ── Apps ───────────────────────────────────────────────────────────────────
  'apps/api/vitest.config.ts',
  'apps/admin-api/vitest.config.ts',
  'apps/worker-a/vitest.config.ts',
  // ── Libraries ──────────────────────────────────────────────────────────────
  'libs/auth0/vitest.config.ts',
  'libs/activity-log/vitest.config.ts',
  'libs/billing/vitest.config.ts',
  'libs/common/vitest.config.ts',
  'libs/email/vitest.config.ts',
  'libs/events/vitest.config.ts',
  'libs/feature-flags/vitest.config.ts',
  'libs/jobs/vitest.config.ts',
  'libs/legal-audit/vitest.config.ts',
  'libs/memberships/vitest.config.ts',
  'libs/notifications/vitest.config.ts',
  'libs/planning/vitest.config.ts',
  'libs/observability/vitest.config.ts',
  'libs/org-deletion/vitest.config.ts',
  'libs/org-export/vitest.config.ts',
  'libs/organizations/vitest.config.ts',
  'libs/prisma-business/vitest.config.ts',
  'libs/prisma-legal/vitest.config.ts',
  'libs/rbac/vitest.config.ts',
  'libs/admin/auth/vitest.config.ts',
  'libs/admin/organizations/vitest.config.ts',
  'libs/admin/memberships/vitest.config.ts',
  'libs/admin/billing/vitest.config.ts',
  'libs/admin/activity-log/vitest.config.ts',
  'libs/admin/entitlements/vitest.config.ts',
  'libs/admin/jobs/vitest.config.ts',
  'libs/redis/vitest.config.ts',
  'libs/security/vitest.config.ts',
  'libs/storage/vitest.config.ts',
  'libs/users/vitest.config.ts',
]);
