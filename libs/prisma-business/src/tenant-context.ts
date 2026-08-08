import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextStore {
  orgId: string | null;
  userId: string | null;
  /**
   * Narrow, explicit RLS escape hatch for lookups that legitimately have no
   * org or user identity to key off yet — e.g. the Stripe webhook resolving
   * *which* org a `stripeCustomerId` belongs to, before anything else about
   * the request is known. Only set this via `runAsSystemLookup`, and only
   * around the single query that needs it — never around a whole request.
   * grep for `runAsSystemLookup` to audit every place this is used.
   */
  systemLookup: boolean;
}

/**
 * Carries the current tenant (`orgId`) and, where known, the current DB
 * user (`userId`) across the async call chain of one HTTP request or one
 * worker job, so PrismaBusinessService can look them up when opening the
 * short-lived, RLS-scoped transaction backing each tenant-scoped model call
 * (see prisma-business.service.ts). `userId` backs the membership-based RLS
 * exception on `memberships`/`organizations` that lets a user list all
 * their own orgs across tenants (see the
 * 20260808120000_enable_row_level_security migration) — most callers only
 * ever need `runWithTenant`.
 *
 * NOTE: Prisma Client Extension `query` hooks (`$extends`) do NOT preserve
 * AsyncLocalStorage context in this stack (Prisma 7 + @prisma/adapter-pg) —
 * confirmed empirically, not merely undocumented. `getCurrentTenantOrgId()`
 * / `getCurrentTenantUserId()` must only ever be called from code that
 * itself calls `$transaction` directly (as PrismaBusinessService's proxy
 * wrapper does), never from inside a `$extends({ query: ... })` hook — that
 * call chain silently loses the store and reads back `null`.
 */
const tenantContextStorage = new AsyncLocalStorage<TenantContextStore>();

function currentStore(): TenantContextStore {
  return (
    tenantContextStorage.getStore() ?? {
      orgId: null,
      userId: null,
      systemLookup: false,
    }
  );
}

/**
 * Runs `fn` with `orgId` bound as the current tenant context. Preserves
 * whatever `userId`/system-lookup flag is already set (nesting-safe) — use
 * `runWithTenantUser` to also set/override the user id.
 *
 * Pass `null` explicitly for legitimately cross-tenant work (e.g. an
 * admin-api request with no single-org scope) — RLS still fails closed for
 * app_runtime in that case; only the separate `app_admin_runtime` role
 * (BYPASSRLS) sees cross-tenant rows regardless of this context.
 */
export function runWithTenant<T>(orgId: string | null, fn: () => T): T {
  return tenantContextStorage.run({ ...currentStore(), orgId }, fn);
}

/**
 * Runs `fn` with `userId` bound as the current tenant context. Preserves
 * whatever `orgId` is already set (nesting-safe).
 *
 * Use for requests/queries that are legitimately scoped to "everything this
 * user has access to" rather than a single org — e.g. `GET /organizations`
 * (list all orgs the caller belongs to). Only a narrow set of RLS policies
 * (`memberships`, `organizations` — read-only) actually consult
 * `app.current_user_id`; it has no effect elsewhere.
 */
export function runWithTenantUser<T>(userId: string | null, fn: () => T): T {
  return tenantContextStorage.run({ ...currentStore(), userId }, fn);
}

/**
 * Runs `fn` with the `app.system_lookup` RLS escape hatch enabled — see
 * `TenantContextStore.systemLookup`. Keep the wrapped scope as small as
 * possible (ideally a single repository call).
 */
export function runAsSystemLookup<T>(fn: () => T): T {
  return tenantContextStorage.run(
    { ...currentStore(), systemLookup: true },
    fn,
  );
}

/** Runs `fn` with the full store set atomically (no reliance on nesting/preserving prior values). */
export function runWithTenantContext<T>(
  store: Partial<TenantContextStore>,
  fn: () => T,
): T {
  return tenantContextStorage.run({ ...currentStore(), ...store }, fn);
}

export function getCurrentTenantOrgId(): string | null {
  return tenantContextStorage.getStore()?.orgId ?? null;
}

export function getCurrentTenantUserId(): string | null {
  return tenantContextStorage.getStore()?.userId ?? null;
}

export function isSystemLookup(): boolean {
  return tenantContextStorage.getStore()?.systemLookup ?? false;
}
