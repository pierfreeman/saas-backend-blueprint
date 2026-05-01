# saas-backend-blueprint

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=pierfreeman_saas-backend-blueprint&metric=alert_status&token=e7e95a4604df254e30ff23cda7a716fd7306d87d)](https://sonarcloud.io/summary/new_code?id=pierfreeman_saas-backend-blueprint) [![CI](https://github.com/pierfreeman/saas-backend-blueprint/actions/workflows/ci.yml/badge.svg)](https://github.com/pierfreeman/saas-backend-blueprint/actions/workflows/ci.yml)

Production-ready multi-tenant SaaS backend built as an [Nx](https://nx.dev) monorepo.

## Tech stack

| Concern            | Choice                                                             |
| ------------------ | ------------------------------------------------------------------ |
| Framework          | NestJS (TypeScript)                                                |
| Monorepo           | Nx                                                                 |
| ORM / migrations   | Prisma 7 (ESM, driver adapter)                                     |
| Databases          | PostgreSQL × 2 (business DB + legal audit DB)                      |
| Cache / pub-sub    | Redis (ioredis)                                                    |
| Authentication     | Auth0 — JWT RS256, JWKS endpoint                                   |
| Billing            | Stripe (checkout, portal, webhooks)                                |
| Event system       | EventEmitter2 (local) / AWS SQS (production)                       |
| Background workers | NestJS standalone app, long-polls SQS Standard queue               |
| Real-time          | Socket.IO with Redis adapter (multi-pod)                           |
| File storage       | AWS S3 (presigned URLs, multi-tenant isolation)                    |
| Containerisation   | Docker Compose (dev + prod + test), unified multi-stage Dockerfile |

## Features

- 🏢 Multi-tenancy with per-org isolation (`x-tenant-id` header → request-scoped context)
- 🔐 Auth0 JWT authentication (RS256, JWKS, automatic user + personal org provisioning on first login)
- 👥 Static RBAC — four roles (OWNER › ADMIN › MEMBER › READ_ONLY), nine permissions
- 💳 Stripe billing — checkout, customer portal, subscription lifecycle, webhook idempotency
- 🚀 Plan-based feature gating with Redis cache and route-level `FeatureGuard`
- ⚡ Async background jobs — create-then-enqueue, real-time status via WebSocket
- 🔔 In-app notifications — Socket.IO namespace, REST API, Redis pub/sub fan-out
- 📋 Two-tier audit logging — tenant-visible activity log + immutable legal audit trail (ISO 27001 / GDPR)
- 🗑️ GDPR-compliant org deletion — configurable retention periods, async worker execution, legal audit preservation
- 📦 GDPR-compliant org export — async JSON+gzip data export, presigned download URLs, automatic expiration (Right to Data Portability)
- ✉️ Event-driven transactional email — Resend/SMTP, Handlebars templates, automatic audit logging
- 🗄️ S3 file storage — presigned upload/download URLs, per-org isolation, quota enforcement, cleanup scheduler
- 🛡️ Defence-in-depth security — rate limiting, brute-force lockout, Helmet, CORS, IP filtering, CSRF
- 📊 Structured observability — JSON logging, Sentry, Prometheus/Datadog stubs
- 🛠️ Admin backoffice portal — dedicated admin Auth0 app (`AdminJwtAuthGuard`), Customer 360 org view, cross-org member management, billing oversight with Stripe plan change + trial extension, activity log, per-org entitlement overrides (set / delete with reason, expiry, and dual audit trail), entitlement cache invalidation, per-org storage quota override

---

## Quick start

From a fresh clone (~2 minutes):

```sh
npm install

# Copy environment file (defaults work out of the box)
cp .env.example .env

# Start infrastructure (Postgres ×2, Redis, LocalStack, Mailpit)
npm run dev:infra

# Run migrations (once per fresh DB, then only after schema changes)
npm run dev:migrate

# Start all apps with hot reload
npm run dev
```

API: `http://localhost:3000` — Swagger: `http://localhost:3000/docs`  
Admin API: `http://localhost:3001` — Admin Swagger: `http://localhost:3001/docs`

---

## Architecture

```
apps/
  api             — HTTP API (NestJS, port 3000)
  api-e2e         — End-to-end tests for the API
  worker-a        — Background worker (polls SQS Standard queue)
  worker-a-e2e    — End-to-end tests for worker-a

libs/
  activity-log    — Tenant-visible operational event log (business DB)
  admin/
    auth          — SystemAdminGuard + CurrentAdminUserId decorator (system-admin gate)
    activity-log  — Cross-org and per-org activity log queries for backoffice
    billing       — Read billing overviews + open Stripe portal on behalf of any org
    entitlements  — Read / invalidate plan entitlements for any org
    memberships   — List, invite, change-role, remove members across any org
    organizations — List all orgs with filters, detail view (Customer 360)
  billing         — Stripe subscription management (checkout, portal, webhooks)
  common          — Shared RBAC constants, tenant context, exception filter
  config          — NestJS ConfigModule wrappers with Joi validation
  email           — Event-driven transactional email (Resend/SMTP, Handlebars templates)
  events          — EventBusService facade (LocalTransport / SQS), DomainEvent types
  legal-audit     — Immutable compliance event recorder (legal DB, ISO 27001 / GDPR)
  org-deletion    — GDPR-compliant organization deletion with retention periods and audit trail
  org-export      — GDPR-compliant organization export with presigned URL
  notifications   — Real-time in-app notifications (Socket.IO + REST + Redis pub/sub)
  observability   — Structured logging, Sentry, Prometheus/Datadog stubs
  planning        — RFC 5545 recurring events, RSVP, per-occurrence exceptions, series splitting (This and Following), event reminder scheduler
  prisma-business — PrismaBusinessService → business DB
  prisma-legal    — PrismaLegalService → legal audit DB
  redis           — CacheService (DB 1) and PubSubService (DB 0)
  security        — Rate limiting, brute-force protection, CORS, Helmet, CSRF
  storage         — S3 file storage (presigned URLs, multi-tenant isolation, quota)

prisma/                  — Business DB (multi-file schema, Prisma v7)
  schema.prisma          — generator + datasource block only
  user.prisma            — User
  organization.prisma    — Organization, OrganizationStatus, BillingStatus
  membership.prisma      — Membership, MembershipRole, MembershipStatus
  activity-log.prisma    — ActivityLog (app_audit schema)
  billing.prisma         — BillingEvent, SubscriptionSnapshot
  notification.prisma    — Notification
  file.prisma            — File, FileStatus
  job.prisma             — Job, OrgExport, JobStatus, ExportStatus
  planning.prisma        — Event, EventAttendee, EventException, RSVPStatus
  migrations/
prisma-legal/
  schema.prisma          — Legal audit DB: AuditEvent (append-only)
  (migrations at prisma/migrations-legal/)
```

### Infrastructure

| Service               | Image                                               | Default port |
| --------------------- | --------------------------------------------------- | ------------ |
| PostgreSQL (business) | `postgres:17-alpine`                                | `5432`       |
| PostgreSQL (legal)    | `postgres:17-alpine`                                | `5433`       |
| Redis                 | `redis:7-alpine`                                    | `6379`       |
| LocalStack (S3, SQS)  | `localstack/localstack:3`                           | `4566`       |
| API                   | built from root `Dockerfile` (`APP_NAME=api`)       | `3000`       |
| Admin API             | built from root `Dockerfile` (`APP_NAME=admin-api`) | `3001`       |
| Worker A              | built from root `Dockerfile` (`APP_NAME=worker-a`)  | —            |
| Migrate               | `migrate` stage of root `Dockerfile`                | —            |

**Two-database design:** The business DB holds domain models (User, Organization, Membership, ActivityLog, Job). The legal audit DB holds append-only AuditEvents for compliance. The two databases are deliberately isolated — compliance logs survive even if the business database is wiped.

---

## Features

### Business

| Feature       | Library                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Multi-tenancy | [`@libs/common`](libs/common/README.md)               | `x-tenant-id` header → request-scoped `TenantContextService`                                                                                                                                                                                                                                                                                                                                                       |
| Auth          | `apps/api`                                            | Auth0 RS256 JWT validation via JWKS; first-call user upsert + personal org + OWNER membership provisioning                                                                                                                                                                                                                                                                                                         |
| RBAC          | [`@libs/common`](libs/common/README.md)               | Static role hierarchy: OWNER > ADMIN > MEMBER > READ_ONLY                                                                                                                                                                                                                                                                                                                                                          |
| Billing       | [`@libs/billing`](libs/billing/README.md)             | Stripe checkout, customer portal, subscription sync, webhooks                                                                                                                                                                                                                                                                                                                                                      |
| Feature flags | [`@libs/feature-flags`](libs/feature-flags/README.md) | Plan-based entitlements with Redis cache and route-level `FeatureGuard`; per-org overrides stored in DB, applied at runtime, invalidated by admin                                                                                                                                                                                                                                                                  |
| Async jobs    | [`@libs/events`](libs/events/README.md)               | Create-then-enqueue pattern; real-time status via WebSocket                                                                                                                                                                                                                                                                                                                                                        |
| Notifications | [`@libs/notifications`](libs/notifications/README.md) | Socket.IO namespace `/notifications`, Redis pub/sub, REST API                                                                                                                                                                                                                                                                                                                                                      |
| Email         | [`@libs/email`](libs/email/README.md)                 | Event-driven transactional email; Resend/SMTP providers; Handlebars templates; fire-and-forget with audit                                                                                                                                                                                                                                                                                                          |
| Activity log  | [`@libs/activity-log`](libs/activity-log/README.md)   | Tenant-visible event log, queryable by ADMIN/OWNER                                                                                                                                                                                                                                                                                                                                                                 |
| Legal audit   | [`@libs/legal-audit`](libs/legal-audit/README.md)     | Immutable compliance trail, ISO 27001 / GDPR, no public API                                                                                                                                                                                                                                                                                                                                                        |
| Org deletion  | [`@libs/org-deletion`](libs/org-deletion/README.md)   | GDPR-compliant org deletion, configurable retention periods, async worker, legal audit preservation                                                                                                                                                                                                                                                                                                                |
| Org export    | [`@libs/org-export`](libs/org-export/README.md)       | GDPR data portability — async JSON+gzip export, presigned download URLs (24 h), automatic expiration                                                                                                                                                                                                                                                                                                               |
| File storage  | [`@libs/storage`](libs/storage/README.md)             | Presigned S3 upload/download, per-org isolation, quota enforcement, cleanup scheduler                                                                                                                                                                                                                                                                                                                              |
| Planning      | [`@libs/planning`](libs/planning/README.md)           | RFC 5545 recurring events, RSVP, per-occurrence exceptions, series splitting (This and Following), calendar range queries, event reminder notifications (cron sweep every 5 min)                                                                                                                                                                                                                                   |
| Admin portal  | `libs/admin/*`                                        | System-admin backoffice: org list/detail, member management, billing oversight (plan change, trial extension, Stripe portal), activity log, per-org entitlement overrides (set / delete / expire; `createdBy` resolved to user name), entitlement cache invalidation, per-org storage quota override. Guard: `AdminJwtAuthGuard` (dedicated admin Auth0 app). Provision users via `scripts/manage-admin-user.mjs`. |

### Architectural

| Concern         | Library                                               | Description                                                              |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Event bus       | [`@libs/events`](libs/events/README.md)               | LocalTransport (dev) or SQS Standard/FIFO (prod), zero call-site changes |
| Cache / pub-sub | [`@libs/redis`](libs/redis/README.md)                 | `CacheService` (TTL store) and `PubSubService` (broadcast channels)      |
| Security        | [`@libs/security`](libs/security/README.md)           | Rate limiting, brute-force lockout, CSRF, Helmet headers, IP filtering   |
| Observability   | [`@libs/observability`](libs/observability/README.md) | Structured JSON logging, Sentry, Prometheus/Datadog stubs                |
| Config          | [`@libs/config`](libs/config/README.md)               | Global `ConfigModule` with Joi validation; typed namespaces              |
| Health          | `apps/api/health`                                     | `/health`, `/health/liveness`, `/health/readiness` for K8s/ECS           |

---

## Prerequisites

- Node.js ≥ 20.19.0 (LTS recommended)
- Docker & Docker Compose v2
- `npm`
- An Auth0 tenant (see [Authentication](#authentication))

---

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Start infrastructure

```sh
npm run dev:infra
```

Starts Postgres × 2, Redis, LocalStack (S3 + SQS), and Mailpit via `docker-compose.dev.yml`. App services run on the host — no Docker rebuild needed on code changes.

Default host ports: business DB → `5432`, legal audit DB → `5434`, Redis → `6380`, LocalStack → `4566`, Mailpit SMTP → `1025`, Mailpit UI → `8025`.

### 3. Configure environment

```sh
cp .env.example .env
```

The defaults in `.env.example` work out of the box for local development, including pre-configured LocalStack SQS URLs.

#### Required variables

| Variable                   | Example                                                      | Description                              |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| `DATABASE_URL`             | `postgresql://postgres:postgres@localhost:5432/saas_backend` | Business PostgreSQL connection string    |
| `LEGAL_AUDIT_DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/saas_legal`   | Legal audit PostgreSQL connection string |
| `REDIS_HOST`               | `localhost`                                                  | Redis hostname                           |
| `REDIS_PORT`               | `6379`                                                       | Redis port                               |
| `AUTH0_DOMAIN`             | `your-tenant.auth0.com`                                      | Auth0 tenant domain (without `https://`) |
| `AUTH0_AUDIENCE`           | `https://api.your-app.com`                                   | Auth0 API audience identifier            |

#### Optional variables

| Variable                      | Default                 | Description                                                                          |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `PORT`                        | `3000`                  | HTTP port the API listens on                                                         |
| `NODE_ENV`                    | `development`           | Runtime environment                                                                  |
| `EVENT_BUS_TRANSPORT`         | `local`                 | `local` (EventEmitter) or `sqs`                                                      |
| `SQS_STANDARD_QUEUE_URL`      | _(LocalStack)_          | Required when `EVENT_BUS_TRANSPORT=sqs`. Pre-filled for LocalStack in `.env.example` |
| `SQS_FIFO_QUEUE_URL`          | _(LocalStack)_          | Required when `EVENT_BUS_TRANSPORT=sqs` (must end in `.fifo`)                        |
| `SQS_ENDPOINT_URL`            | `http://localhost:4566` | LocalStack endpoint (leave empty for real AWS)                                       |
| `STRIPE_SECRET_KEY`           | —                       | Stripe secret key                                                                    |
| `STRIPE_WEBHOOK_SECRET`       | —                       | Stripe webhook signing secret (`whsec_…`)                                            |
| `STRIPE_PRICE_ID_PRO`         | —                       | Stripe Price ID → PRO tier                                                           |
| `STRIPE_PRICE_ID_ENTERPRISE`  | —                       | Stripe Price ID → ENTERPRISE tier                                                    |
| `EMAIL_PROVIDER`              | `resend`                | Email provider: `resend` or `smtp`                                                   |
| `EMAIL_FROM_ADDRESS`          | —                       | Sender email address                                                                 |
| `EMAIL_FROM_NAME`             | —                       | Sender display name                                                                  |
| `RESEND_API_KEY`              | —                       | Resend API key (required when `EMAIL_PROVIDER=resend`)                               |
| `SMTP_HOST`                   | —                       | SMTP host (required when `EMAIL_PROVIDER=smtp`)                                      |
| `SENTRY_DSN`                  | —                       | Sentry project DSN                                                                   |
| `CORS_ALLOWED_ORIGINS`        | _(all in dev)_          | Comma-separated allowed origins (required in production)                             |
| `RATE_LIMIT_MAX_PER_IP`       | `100`                   | Rate limit requests per window per IP                                                |
| `BRUTE_FORCE_MAX_ATTEMPTS`    | `5`                     | Auth failures before IP lockout                                                      |
| `AWS_REGION`                  | `us-east-1`             | AWS region for S3                                                                    |
| `AWS_ACCESS_KEY_ID`           | —                       | AWS access key (use `test` for LocalStack)                                           |
| `AWS_SECRET_ACCESS_KEY`       | —                       | AWS secret key (use `test` for LocalStack)                                           |
| `AWS_S3_BUCKET`               | —                       | S3 bucket name                                                                       |
| `AWS_S3_ENDPOINT`             | —                       | Override endpoint, e.g. `http://localhost:4566` (LocalStack)                         |
| `EXPORT_URL_EXPIRATION_HOURS` | `24`                    | Signed export download URL lifetime (hours)                                          |
| `AUTH0_M2M_CLIENT_ID`         | —                       | Auth0 M2M application Client ID — required for email invites                         |
| `AUTH0_M2M_CLIENT_SECRET`     | —                       | Auth0 M2M application Client Secret — required for email invites                     |
| `AUTH0_SPA_CLIENT_ID`         | —                       | Auth0 SPA application Client ID — required for passwordless invites                  |
| `FRONTEND_BASE_URL`           | `http://localhost:4200` | Frontend base URL embedded in invite emails                                          |

For the complete variable list for each subsystem, see the relevant library README.

### 4. Generate Prisma clients

```sh
npm run prisma:generate
```

Generates both clients (business + legal) in one command. Clients output to `libs/prisma-business/src/generated/prisma/` and `libs/prisma-legal/src/generated/prisma/`. These directories are gitignored — also runs automatically via `postinstall`.

### 5. Run database migrations

```sh
npm run dev:migrate
```

Runs `prisma migrate dev` for both databases. Append `--name <description>` when calling Prisma directly:

```sh
npx prisma migrate dev --name add-user-field
npx prisma migrate dev --config prisma.config.legal.ts --name add-audit-field
```

### 6. Serve applications

```sh
# All three apps in one terminal (recommended)
npm run dev

# Kill zombie processes from a previous crashed run
npm run dev:kill

# Or individually
npx nx serve api        # HTTP API on :3000
npx nx serve admin-api  # Admin API on :3001
npx nx serve worker-a   # Background worker (polls SQS)
```

> **Port assignment:** `api` listens on `PORT` (default `3000`). `admin-api` reads `ADMIN_API_PORT` first (default `3001`), falling back to `PORT`. Both are set in `.env`.

---

## Docker

### Local development (no rebuilds on code changes)

```sh
# Start infrastructure only
npm run dev:infra

# Run apps on the host with hot reload
npm run dev

# Stop infrastructure
npm run dev:infra:down
```

### Production-like full stack

```sh
# Build and start everything (uses unified root Dockerfile)
docker compose up --build

# Rebuild a single service
docker compose build api
docker compose build admin-api
docker compose build worker-a

# Or build standalone images
npm run docker:build:api
npm run docker:build:admin-api
npm run docker:build:worker-a
```

The unified `Dockerfile` at the repo root uses multi-stage builds with BuildKit cache mounts. Changing source code only re-runs the `build` stage — `npm ci` and Prisma generation stay cached unless `package-lock.json` or schema files change.

---

## Authentication

The API uses **Auth0** as the identity provider. All protected endpoints require a JWT Bearer token.

1. Create an Auth0 API in the dashboard and set an audience (e.g. `https://api.your-app.com`).
2. Add `AUTH0_DOMAIN` and `AUTH0_AUDIENCE` to `.env`.
3. Obtain a token (Machine-to-Machine app or SPA flow) and send it as `Authorization: Bearer <token>`.

On first call to `GET /auth/me` the user is upserted using the `sub` JWT claim.

### Email-based member invites (M2M)

The `POST /organizations/:orgId/memberships/invite` endpoint creates new Auth0 users on-the-fly when the invited email doesn't exist yet. It requires a **Machine-to-Machine application** with the Auth0 Management API scope:

1. In the Auth0 dashboard → **Applications → Applications → Create Application → Machine to Machine**.
2. Authorize it against the **Auth0 Management API** with at minimum the `create:users` and `create:password_change_tickets` scopes.
3. Copy the Client ID and Client Secret to `.env`:
   ```
   AUTH0_M2M_CLIENT_ID=<your-m2m-client-id>
   AUTH0_M2M_CLIENT_SECRET=<your-m2m-client-secret>
   ```
4. Set `AUTH0_SPA_CLIENT_ID` to the **Client ID of your SPA application** (the same one used by the frontend). This is required for the backend to trigger passwordless email invites on behalf of users:
   ```
   AUTH0_SPA_CLIENT_ID=<your-spa-client-id>
   ```
5. Set `FRONTEND_BASE_URL` to your deployed frontend URL (used as the redirect after password reset and as the invite landing page for existing users).

> If `AUTH0_M2M_CLIENT_ID` / `AUTH0_M2M_CLIENT_SECRET` are left blank the invite endpoint will throw a `500` when called — all other endpoints continue to work normally.

---

## RBAC

Authorization is static — no database-driven role tables.

**Role hierarchy:** `OWNER > ADMIN > MEMBER > READ_ONLY`

| Permission                | OWNER | ADMIN | MEMBER | READ_ONLY |
| ------------------------- | :---: | :---: | :----: | :-------: |
| `org.manage`              |   ✓   |       |        |           |
| `org.billing.manage`      |   ✓   |       |        |           |
| `org.members.invite`      |   ✓   |   ✓   |        |           |
| `org.members.remove`      |   ✓   |   ✓   |        |           |
| `org.members.role.update` |   ✓   |   ✓   |        |           |
| `org.read`                |   ✓   |   ✓   |   ✓    |     ✓     |
| `audit.read`              |   ✓   |   ✓   |        |           |
| `analytics.view`          |   ✓   |   ✓   |   ✓    |           |
| `analytics.export`        |   ✓   |   ✓   |        |           |

To add a permission: add the constant in `libs/common/src/rbac/permissions.constants.ts`, assign it in `roles.constants.ts`, then guard the endpoint with `@RequirePermissions([PERMISSIONS.YOUR_PERMISSION])`.

See [`@libs/common`](libs/common/README.md) for RBAC helpers and tenant context utilities.

---

## Admin backoffice portal

Admin access is gated by a **dedicated Auth0 application** (`SaaS Admin Portal`) completely separate from the tenant platform. Admin users are stored in the `admin_users` table in the legal audit DB — they have no relation to the tenant `users` table.

### Guard pipeline for admin routes

```
AdminJwtAuthGuard
```

`AdminJwtAuthGuard` (in `@libs/admin/auth`) validates JWTs against the admin Auth0 audience (`ADMIN_AUTH0_AUDIENCE`). Any request without a valid admin JWT receives `401 Unauthorized`.

### Provisioning admin users

```sh
# Create a new admin user
node scripts/manage-admin-user.mjs --create --email user@example.com --name "Alice"

# List all admin users
node scripts/manage-admin-user.mjs --list

# Disable an admin user
node scripts/manage-admin-user.mjs --disable --email user@example.com

# Trigger password reset
node scripts/manage-admin-user.mjs --reset-password --email user@example.com
```

Admin accounts are **never created by the login flow** — only via the CLI script.

### Admin API endpoints (all under `/admin`, require `AdminJwtAuthGuard`)

| Method   | Path                                                     | Description                                                                                   |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST`   | `/admin/organizations`                                   | Provision an enterprise org — create org, optionally assign plan, invite owner                |
| `GET`    | `/admin/organizations`                                   | List all orgs — search, status filter, pagination                                             |
| `GET`    | `/admin/organizations/:orgId`                            | Org detail (Customer 360) — membership count, billing snapshot, recent activity, entitlements |
| `GET`    | `/admin/organizations/:orgId/memberships`                | Paginated member list for an org                                                              |
| `POST`   | `/admin/organizations/:orgId/memberships`                | Invite a new member to any org                                                                |
| `PATCH`  | `/admin/organizations/:orgId/memberships/:memberId/role` | Change a member's role                                                                        |
| `DELETE` | `/admin/organizations/:orgId/memberships/:memberId`      | Remove a member                                                                               |
| `GET`    | `/admin/organizations/:orgId/billing`                    | Billing overview (Stripe status, plan, period)                                                |
| `POST`   | `/admin/organizations/:orgId/billing/portal`             | Generate a Stripe portal URL for any org                                                      |
| `GET`    | `/admin/organizations/:orgId/activity-log`               | Paginated activity log scoped to an org                                                       |
| `GET`    | `/admin/activity-log`                                    | Cross-org activity log — optional org/action/date filters                                     |
| `GET`    | `/admin/organizations/:orgId/entitlements`               | Read plan entitlements for an org                                                             |
| `GET`    | `/admin/organizations/:orgId/entitlements/overrides`     | List all entitlement overrides (active + expired) with `createdByName`                        |
| `POST`   | `/admin/organizations/:orgId/entitlements/invalidate`    | Flush entitlement Redis cache for an org                                                      |
| `PATCH`  | `/admin/organizations/:orgId/feature-flags`              | Create or update an entitlement override (`key`, `value`, `reason`, `expiresAt?`)             |
| `DELETE` | `/admin/organizations/:orgId/feature-flags/:key`         | Delete an entitlement override by key                                                         |

### Library layout

```
libs/admin/
  auth/           — SystemAdminGuard, CurrentAdminUserId decorator, AdminAuthModule
  activity-log/   — AdminActivityLogService: per-org and cross-org log queries
  billing/        — AdminBillingService: billing overview + Stripe portal delegation
  entitlements/   — AdminEntitlementsService: read/invalidate entitlements + override CRUD (set/delete/list with createdByName)
  memberships/    — AdminMembershipsService: list, invite, change-role, remove
  organizations/  — AdminOrganizationsService: list all orgs + Customer 360 detail + enterprise provisioning
```

---

Jobs follow a create-then-enqueue pattern so every job is immediately queryable:

```
POST /tasks/heavy-job
  ├─ prisma.job.create(PENDING)        ← queryable instantly via REST
  └─ EventBusService.publish → SQS
                              Worker polls SQS
                                ├─ job.update(PROCESSING) → Redis pub/sub → WebSocket
                                └─ job.update(DONE|FAILED) → Redis pub/sub → WebSocket
```

**State machine:** `PENDING → PROCESSING → DONE | FAILED`

WebSocket namespace `/jobs` — rooms: `user:{userId}`, `tenant:{tenantId}` — event: `job:update`.

See [`@libs/events`](libs/events/README.md) for event routing, the `DomainEvent` interface, and worker patterns.

---

## Testing

Two independent suites. Do not run them in parallel — they share test databases.

### Unit tests

```sh
npm run test:unit           # all projects
npx nx test api             # single project
npm run test:watch          # watch mode
```

### Integration tests

```sh
npm run test:infra:up       # start test containers (Postgres ×2, Redis, LocalStack)
npm run test:migrate        # apply migrations to test DBs (once per fresh container)

npm run test:integration    # both suites sequentially
npm run test:integration:api
npm run test:integration:worker

npm run test:infra:down
```

> Both `api-e2e` and `worker-a-e2e` share the test database. `--parallel=1` is enforced to prevent race conditions between `cleanDatabase()` calls and in-flight job processing.

### Coverage

```sh
npm run test:coverage              # unit → coverage/unit/
npm run test:integration:coverage  # integration → coverage/integration/
npm run coverage:serve             # serve reports at http://localhost:4321
```

---

## Development tools

### Swagger / OpenAPI

```
http://localhost:3000/docs
```

### Prisma Studio

```sh
npx prisma studio                                   # business DB
npx prisma studio --config prisma.config.legal.ts   # legal audit DB
```

### Schema changes

When you modify any `.prisma` file under `prisma/` or `prisma-legal/schema.prisma`:

```sh
# Re-generate both clients
npm run prisma:generate

# Then create a migration
npx prisma migrate dev --name <description>
npx prisma migrate dev --config prisma.config.legal.ts --name <description>
```

### Nx tasks

```sh
npx nx build api
npx nx lint api
npx nx run-many -t lint
npx nx graph                  # visualise project dependency graph
npx nx show project api       # list all targets for a project
```

### Adding a new project

```sh
npx nx g @nx/nest:app my-app   # new NestJS application
npx nx g @nx/node:lib my-lib   # new shared library
```
