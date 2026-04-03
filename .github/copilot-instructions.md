# Copilot Instructions — saas-backend-blueprint

> Copilot loads this file automatically as global project context.
> For deeper detail, read the per-module READMEs via progressive disclosure.

---

## Project overview

Multi-tenant SaaS backend — Nx 22 monorepo, NestJS 11, Prisma 7, PostgreSQL × 2.
Two runtime apps: HTTP API (port 3000) + async background worker (SQS).
Pairs with [saas-frontend-blueprint](../saas-frontend-blueprint) (Angular 21 + Module Federation).

## Tech stack

NestJS 11 · Nx 22 · Prisma 7 · PostgreSQL × 2 (business + legal audit) · Redis · Auth0 RS256 JWT · Stripe · SQS (LocalStack dev) · Socket.IO 4.8 · Vitest 4

## Monorepo layout

```
apps/api/          → HTTP API (NestJS, port 3000, Swagger at /docs)
apps/worker-a/     → Background worker (polls SQS)
apps/api-e2e/      → Integration tests
apps/worker-a-e2e/ → Worker integration tests

libs/
  activity-log/    → Tenant-visible event log
  auth/            → Auth0 JWT validation, user upsert
  billing/         → Stripe subscriptions (Pattern A — DDD)
  common/          → RBAC constants, tenant context, exception filter
  config/          → ConfigModule with Joi validation
  email/           → Transactional email (Resend/SMTP)
  events/          → EventBusService (Local/SQS)
  jobs/            → Background job lifecycle
  legal-audit/     → Immutable compliance trail (legal DB)
  memberships/     → Org membership CRUD, invitations
  notifications/   → Socket.IO + REST + Redis pub/sub
  planning/        → RFC 5545 events, RRULE, RSVP, reminders
  rbac/            → Guards, decorators, permission resolver
  security/        → Rate limiting, Helmet, CORS, CSRF
  storage/         → S3 presigned URLs, per-org isolation (Pattern A)
  ...
```

## Code style — hard rules

1. **Thin controllers** — delegate immediately to library services. No business logic in apps/.
2. **Never import foreign repositories** — use the application service.
3. **Never export repositories** from module `exports[]` or `index.ts`.
4. **Prisma only in repositories** — not in services, not in controllers.
5. **Single-aggregate repositories** — multi-aggregate coordination in services.
6. **Domain event handlers in libs/** — not in apps/.
7. **DTOs** — `class-validator` + `@ApiProperty()`, definite assignment (`!:`).
8. **Global ValidationPipe** — `whitelist: true`, `forbidNonWhitelisted: true`.

## Five architectural patterns

| Pattern | Name           | When                   | Examples                    |
| ------- | -------------- | ---------------------- | --------------------------- |
| A       | Full DDD       | External integration   | billing, storage            |
| B       | 2-layer        | Domain aggregate       | memberships, planning, jobs |
| D       | Cross-cutting  | Framework constructs   | rbac, security              |
| E       | Flat           | Single-concern utility | events, email, redis        |
| F       | App-layer thin | In apps/               | controller + DTOs only      |

## Guard pipeline

```
JwtAuthGuard → OrgContextGuard → RBACGuard
```

## RBAC

Role hierarchy: `OWNER > ADMIN > MEMBER > READ_ONLY`. 9 permissions.
`@RequirePermissions()` + `@OrgScoped()` decorators. Redis-cached (TTL 10 min).

## Dual audit

Every CUD: `activityLog.logActivity()` + `legalAudit.recordEvent()` (fire-and-forget).

## Testing

- **Vitest 4** — unit + integration (no E2E browser tests).
- Spec files co-located: `{name}.spec.ts` next to source.
- Unit: mock all dependencies with `vi.fn()`, never real Prisma.
- Integration: real DB, `nock-auth.ts` for Auth0, `maxWorkers: 1`.
- Always reset mocks in `beforeEach`.

## Security

- Auth0 RS256 JWT via JWKS. Never decode/store JWTs manually.
- `OrgContextGuard` enforces multi-tenancy. `x-org-id` header.
- ValidationPipe strips unknown properties. Helmet + CORS + rate limiting.
- Two-database design: business DB + immutable legal audit DB.

## Commands

```sh
npm install
docker compose up -d postgres postgres-legal redis
npx prisma generate && npx prisma generate --config prisma.config.legal.ts
npx prisma migrate dev && npx prisma migrate dev --config prisma.config.legal.ts
npx nx serve api                    # API
npx nx serve worker-a               # Worker
npm run test:unit                    # Unit tests
npm run test:integration             # Integration tests
npx nx run-many -t lint --all        # Lint
```

## Anti-patterns (forbidden)

- Importing foreign repositories → use application service
- Exporting repositories → export services only
- Business logic in controllers → delegate to lib service
- Prisma calls outside repositories → use repository methods
- Event handlers in apps/ → put in libs/
- Skipping dual audit on CUD → always log to both audit trails

## Where to find more

| Topic                 | File                            |
| --------------------- | ------------------------------- |
| Architecture patterns | `.claude/rules/architecture.md` |
| Full code style       | `.claude/rules/code-style.md`   |
| Testing conventions   | `.claude/rules/testing.md`      |
| Security rules        | `.claude/rules/security.md`     |
| Contributing guide    | `CONTRIBUTING.md`               |
| Per-lib detail        | `libs/{name}/README.md`         |
