# CLAUDE.md — saas-backend-blueprint

> This file gives Claude (and other AI agents) deep project context.
> Rules in `.claude/rules/` are loaded automatically alongside this file.
> Per-module READMEs provide additional domain detail — use progressive disclosure.

---

## Project overview

Production-ready **multi-tenant SaaS backend** built as an Nx monorepo.
Two runtime apps: an HTTP API and an async background worker.
Domain logic lives in 20+ shared libraries. Apps are thin orchestration layers.

Pairs with [saas-frontend-blueprint](../saas-frontend-blueprint) (Angular 21 + Module Federation).

---

## Tech stack

| Concern            | Choice                                                    |
| ------------------ | --------------------------------------------------------- |
| Framework          | NestJS 11 (TypeScript)                                    |
| Monorepo           | Nx 22                                                     |
| ORM / migrations   | Prisma 7 (ESM, driver adapter)                            |
| Databases          | PostgreSQL × 2 (business DB + legal audit DB)             |
| Cache / pub-sub    | Redis 7 (ioredis)                                         |
| Authentication     | Auth0 — JWT RS256, JWKS endpoint                          |
| Billing            | Stripe (checkout, portal, webhooks)                       |
| Event system       | EventEmitter2 (local) / AWS SQS (production)              |
| Background workers | NestJS standalone app, long-polls SQS Standard queue      |
| Real-time          | Socket.IO 4.8 with Redis adapter (multi-pod)              |
| File storage       | AWS S3 (presigned URLs, multi-tenant isolation)           |
| Email              | Resend / SMTP, Handlebars templates                       |
| Containerisation   | Docker Compose (dev + test), multi-stage Dockerfiles      |
| Testing            | Vitest 4 (unit + integration)                             |
| Observability      | Structured JSON logging, Sentry, Prometheus/Datadog stubs |
| Package manager    | pnpm                                                      |

---

## Monorepo structure

```
apps/
  api/           → HTTP API (NestJS, port 3000) + Swagger docs at /docs
  api-e2e/       → Integration tests for the API
  worker-a/      → Background worker (polls SQS Standard queue)
  worker-a-e2e/  → Integration tests for worker-a

libs/
  activity-log/    → Tenant-visible operational event log (business DB)
  auth/            → Auth0 JWT validation, user upsert, personal org provisioning
  billing/         → Stripe subscription management (checkout, portal, webhooks)
  common/          → Shared RBAC constants, tenant context, exception filter
  config/          → NestJS ConfigModule wrappers with Joi validation
  email/           → Event-driven transactional email (Resend/SMTP, Handlebars)
  events/          → EventBusService facade (LocalTransport / SQS)
  feature-flags/   → Plan-based entitlements with Redis cache + route-level FeatureGuard
  jobs/            → Background job lifecycle (create → enqueue → process → done/fail)
  legal-audit/     → Immutable compliance event recorder (legal DB, ISO 27001 / GDPR)
  memberships/     → Org membership CRUD, invitations, role management
  notifications/   → Real-time in-app notifications (Socket.IO + REST + Redis pub/sub)
  observability/   → Structured logging, Sentry, Prometheus/Datadog stubs
  org-deletion/    → GDPR-compliant org deletion with retention periods
  org-export/      → GDPR-compliant org export with presigned download URLs
  organizations/   → Org CRUD, org status management
  planning/        → RFC 5545 recurring events, RSVP, exceptions, series splitting, reminders
  prisma-business/ → PrismaBusinessService → business DB
  prisma-legal/    → PrismaLegalService → legal audit DB
  rbac/            → Guards, decorators, permission resolver, RBAC cache
  redis/           → CacheService (TTL store) + PubSubService (broadcast)
  security/        → Rate limiting, brute-force protection, CORS, Helmet, CSRF
  shared/          → Shared utilities and types
  storage/         → S3 file storage (presigned URLs, per-org isolation, quota)
  users/           → User CRUD, profile management

prisma/            → Business DB (multi-file schema, Prisma v7)
prisma-legal/      → Legal audit DB (append-only AuditEvent)
```

---

## Architecture — key concepts

### Five architectural patterns

| Pattern | Name                          | When to use                                        | Examples                                   |
| ------- | ----------------------------- | -------------------------------------------------- | ------------------------------------------ |
| A       | Full 3-layer DDD              | External integration boundary (Stripe, S3)         | billing, storage                           |
| B       | 2-layer (application + infra) | Domain aggregate with stable DB schema             | memberships, organizations, planning, jobs |
| D       | Cross-cutting constructs      | Framework-level (guards, interceptors, decorators) | rbac, security, observability, common      |
| E       | Flat single-concern           | Single module + service, minimal structure         | events, email, redis, config, activity-log |
| F       | App-layer thin module         | Inside apps/ — controller + DTOs + module wiring   | apps/api/src/app/{feature}/                |

### Two-database design

- **Business DB** (PostgreSQL, port 5432) — User, Organization, Membership, Job, Event, Notification, etc.
- **Legal audit DB** (PostgreSQL, port 5433) — Append-only `AuditEvent` for compliance (ISO 27001 / GDPR)
- Deliberately isolated — legal logs survive even if the business database is wiped.

### Guard pipeline (request flow)

```
JwtAuthGuard → OrgContextGuard → RBACGuard
```

1. **JwtAuthGuard** — RS256 JWT validation via Auth0 JWKS. Attaches `{ sub, email }` to `request.user`.
2. **OrgContextGuard** — Triggered by `@OrgScoped()`. Extracts `orgId` from params/query/body/`x-org-id` header. Verifies membership. Injects `request.orgId`, `request.membership`, `request.tenantContext`.
3. **RBACGuard** — `@RequirePermissions()` or `@RequireRole()`. Resolves permissions via Redis-cached role map (TTL 10 min).

### Interceptor / middleware pipeline

```
RequestSizeLimit → PayloadSanitization → TenantMiddleware → [Guards] → Controller
```

### RBAC

Static role→permission map: `OWNER > ADMIN > MEMBER > READ_ONLY`.
9 permissions: `org.manage`, `org.billing.manage`, `org.members.invite`, `org.members.remove`, `org.members.role.update`, `org.read`, `audit.read`, `analytics.view`, `analytics.export`.
Redis cache key: `rbac:user:{userId}:org:{orgId}` (TTL 600s), invalidated on membership CRUD.

### Event bus

`EventBusService` abstracts `LocalTransport` (dev, EventEmitter2) and `SQS` (prod, Standard + FIFO queues).
Workers long-poll SQS. Zero call-site changes between transports.

### Async jobs

```
POST → prisma.job.create(PENDING) → EventBusService.publish → SQS
Worker polls → PROCESSING → DONE | FAILED → Redis pub/sub → WebSocket
```

State machine: `PENDING → PROCESSING → DONE | FAILED`.
WebSocket namespace `/jobs` — rooms: `user:{userId}`, `tenant:{tenantId}`.

### Dual audit logging

Every CUD operation triggers:

1. `activityLog.logActivity()` — tenant-visible, queryable by ADMIN/OWNER
2. `legalAudit.recordEvent()` — immutable, compliance-only, no public API

Both are fire-and-forget (non-blocking).

---

## Essential commands

```sh
# Install
pnpm install

# Infrastructure
docker compose up -d postgres postgres-legal redis

# Prisma clients (required after clone and schema changes)
npx prisma generate
npx prisma generate --config prisma.config.legal.ts

# Migrations
npx prisma migrate dev
npx prisma migrate dev --config prisma.config.legal.ts

# Serve
npx nx serve api           # HTTP API on :3000
npx nx serve worker-a      # Background worker

# Tests
npm run test:unit                    # All unit tests
npx nx test api                      # Single project
npm run test:watch                   # Watch mode

# Integration tests
npm run test:infra:up                # Start test containers
npm run test:migrate                 # Apply test migrations
npm run test:integration             # Run all integration tests
npm run test:infra:down              # Stop test containers

# Coverage
npm run test:coverage                # Unit coverage
npm run test:coverage:integration    # Integration coverage

# Lint
npx nx run-many -t lint --all

# Type-check
npx nx run-many -t typecheck --all

# Full stack (Docker)
docker compose up --build
```

> Always run tasks through `nx` (never the underlying tooling directly).

---

## Deployment

Docker multi-stage builds. `Dockerfile.migrate` runs Prisma migrations separately from app images.
Infra: PostgreSQL × 2, Redis, SQS (AWS), S3 (AWS).

---

## Where to find more detail

| Topic                       | File                                                 |
| --------------------------- | ---------------------------------------------------- |
| Architecture patterns (A–F) | `CONTRIBUTING.md` (§2)                               |
| Adding libs / apps          | `CONTRIBUTING.md` (§4–§5)                            |
| Hard rules & anti-patterns  | `CONTRIBUTING.md` (§6, §9)                           |
| Testing conventions         | `CONTRIBUTING.md` (§7) + `.claude/rules/testing.md`  |
| Code style rules            | `.claude/rules/code-style.md`                        |
| Security rules              | `.claude/rules/security.md`                          |
| Architecture rules          | `.claude/rules/architecture.md`                      |
| RBAC / permissions model    | `libs/common/README.md` + `libs/rbac/README.md`      |
| Per-lib domain detail       | `libs/{name}/README.md`                              |
| API conventions             | `../saas-context-docs/docs/api/conventions.md`       |
| Full architecture overview  | `../saas-context-docs/docs/architecture/overview.md` |

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
