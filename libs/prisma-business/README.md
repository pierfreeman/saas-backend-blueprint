# @libs/prisma-business

`PrismaBusinessService` — the single injectable gateway to the business PostgreSQL database. Extends the generated `PrismaClient` (Prisma 7, ESM) so all model accessors (`this.user`, `this.organization`, `this.activityLog`, etc.) are available directly on the service instance. The client uses `@prisma/adapter-pg` (the official Node.js PostgreSQL driver adapter) instead of the legacy embedded Rust engine.

---

## Generated client

The Prisma client is generated into `libs/prisma-business/src/generated/prisma/` (gitignored). Run after every schema change or fresh clone:

```sh
npx prisma generate
```

Config is auto-detected from `prisma.config.ts` at the repo root.

---

## Models

Defined across `prisma/*.prisma` (multi-file schema):

| Model          | Description                                     |
| -------------- | ----------------------------------------------- |
| `User`         | Application user, keyed on Auth0 `sub`          |
| `Organization` | Multi-tenant unit; holds billing state          |
| `Membership`   | User ↔ Organization join with RBAC role         |
| `ActivityLog`  | Operational event log (`app_audit` schema)      |
| `Job`          | Async job record with lifecycle status tracking |
| `Notification` | In-app notification                             |

---

## Usage

Import `PrismaBusinessModule` in any module that needs database access:

```typescript
import { PrismaBusinessModule } from '@libs/prisma-business';

@Module({ imports: [PrismaBusinessModule] })
export class OrgsModule {}
```

Then inject `PrismaBusinessService` and use it like PrismaClient:

```typescript
constructor(private readonly prisma: PrismaBusinessService) {}

const org = await this.prisma.organization.findUniqueOrThrow({ where: { id } });
```

---

## Configuration

Reads `database.url` from `ConfigService` (falls back to `DATABASE_URL` env var). `ConfigModule` must be imported at the application root.

| Variable       | Description                                      |
| -------------- | ------------------------------------------------ |
| `DATABASE_URL`                 | PostgreSQL connection string — `app_runtime` role for apps/api and apps/worker-a, `app_admin_runtime` role for apps/admin-api |
| `MIGRATE_DATABASE_URL`         | Superuser/owner connection string, used only by `prisma migrate` and `scripts/provision-runtime-roles.mjs` |
| `APP_RUNTIME_DB_PASSWORD`      | Password synced onto the `app_runtime` role by `scripts/provision-runtime-roles.mjs` after every migration |
| `APP_ADMIN_RUNTIME_DB_PASSWORD` | Password synced onto the `app_admin_runtime` role |

---

## Row-Level Security (tenant isolation backstop)

Every `orgId`-bearing table has a Postgres Row-Level Security policy — see
`prisma/migrations/20260808120000_enable_row_level_security`. This exists
because application-level `orgId` filtering is easy to forget in a single
repository method (two real examples that motivated it: `memberships`'s
`findById`/`update` and `jobs`'s `markProcessing`/`markDone`/`markFailed`/
`delete` used to filter by `id` alone). RLS makes a missing filter
**fail closed** (zero rows) instead of silently leaking another tenant's
data, independent of application code correctness.

**Roles**: `app_runtime` (RLS-subject — api, worker-a) and
`app_admin_runtime` (`BYPASSRLS` — admin-api, which legitimately needs
cross-org access via its own separate trust boundary, `AdminJwtAuthGuard` +
a dedicated Auth0 app). Migrations run as a superuser/owner role
(`MIGRATE_DATABASE_URL`), which is required to `CREATE POLICY` and is never
used by a running app.

**How the policies see the current tenant**: every `orgId`-bearing model
delegate on this service (`this.membership`, `this.job`, ...) is wrapped in
`onModuleInit` by a `Proxy` that opens its own short-lived transaction per
call and runs `SELECT set_config('app.current_org_id', ...)` (plus
`app.current_user_id` and `app.system_lookup`, see below) before delegating
to the real query — see `wrapTenantScopedDelegates()` in
`prisma-business.service.ts`. The values come from
[`tenant-context.ts`](./src/tenant-context.ts), an `AsyncLocalStorage`-based
context propagated by:
- `TenantContextMiddleware` (`@libs/rbac`) — runs *before* guards, so
  `OrgContextGuard`'s own membership/org lookups aren't blocked by a
  missing context.
- `TenantContextInterceptor` (`@libs/rbac`) — re-establishes it from the
  guard-validated `request.orgId`/`dbUserId` for the controller/service
  layer.
- Explicit `runWithTenant(orgId, fn)` calls at the top of worker job
  handlers (`apps/worker-a/src/worker.controller.ts`) and any self-contained
  "unit of work" that already knows its own orgId (e.g.
  `OrgDeletionWorkerService#executeDeletion`, the Stripe webhook handlers).

**This is deliberately a `Proxy`, not a Prisma Client Extension**
(`$extends`): extension `query` hooks were confirmed empirically to **not**
preserve `AsyncLocalStorage` context in this stack (Prisma 7 +
`@prisma/adapter-pg`) — a hook always observed a lost/empty store, even in
the simplest passthrough case with no transaction involved. A plain
`Proxy` whose trap itself calls `this.$transaction(...)` directly (not from
inside `$extends`) does preserve the context, because the call originates
from our own code rather than from inside Prisma's extension dispatch.

**Explicit multi-model `$transaction` calls bypass the Proxy** (it only
wraps top-level delegate properties, not `$transaction` itself) and must
set `app.current_org_id` themselves via `tx.$executeRaw`. Search the
codebase for `// Bypasses PrismaBusinessService's per-delegate RLS proxy`
for the full, current list (as of writing: `organizations.repository.ts`
`createWithOwner`, `user.repository.ts` `provisionWithPersonalOrg`,
`billing.repository.ts` `updateOrgAndSnapshotTx`/`findSnapshotsByOrgId`,
`planning.repository.ts` `splitSeries`, `org-deletion.repository.ts`
`deleteDatabaseRecords`, `org-export.repository.ts` `createExportJob`).

**Two additional GUCs beyond `app.current_org_id`**, both consulted only by
a narrow, explicitly-documented set of policies:
- `app.current_user_id` (set via `runWithTenantUser`) — lets
  `memberships`/`organizations` (read-only) and `notifications`
  (read+write) also match rows by the current user, for queries that are
  legitimately cross-org for one user rather than scoped to one org (e.g.
  `GET /organizations` — list every org the caller belongs to; marking a
  notification read with no `x-org-id` header sent).
- `app.system_lookup` (set via `runAsSystemLookup`) — a narrow escape
  hatch for lookups that have no org or user identity to key off *yet*,
  e.g. the Stripe webhook resolving which org a `stripeCustomerId` or an
  already-processed `stripeEventId` belongs to before anything else about
  the request is known. Keep any `runAsSystemLookup` scope as small as
  possible (ideally one repository call) — grep for it to audit every use.

Neither GUC ever loosens a `WITH CHECK` (write) clause in a way that lets a
user grant themselves access to something new — see the migration file's
per-table comments for the reasoning on each exception.

**Verification**: `npm run verify:rls` (also runs in CI, see
`.github/workflows/ci.yml`) fails the build if any table with an `org_id`
column is missing RLS or a policy — a drift check, not a behavior test. For
behavior, see `apps/api-e2e/src/multi-tenancy/rls-backstop.integration.spec.ts`,
which reproduces the two real "forgot the where clause" bugs above against
the app's real `app_runtime`-scoped connection and asserts RLS blocks them.

---

## Notes

- This is the **only** service that should access the business database. Do not instantiate `PrismaClient` from `@prisma/client` directly — import from `@libs/prisma-business` instead.
- For the legal audit database use [`@libs/prisma-legal`](../prisma-legal/README.md).
- The service logs slow queries and errors via NestJS `Logger` in development. Query logging is event-driven and does not affect production throughput.
- The client is pure JavaScript/TypeScript (no Rust binary) and is bundled by webpack into the app bundle — no `prisma generate` step is needed in the production Docker image.
