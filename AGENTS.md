# AGENTS.md — saas-backend-blueprint

> Loaded by Copilot and other VS Code agents as workspace context.
> Full instructions in `.github/copilot-instructions.md`. Rules in `.claude/rules/`.

---

## Project summary

Multi-tenant SaaS backend — **Nx 22**, **NestJS 11**, **Prisma 7**, **PostgreSQL × 2**.
Two apps: API (port 3000) + SQS worker. 20+ shared libraries.
Frontend: [saas-frontend-blueprint](../saas-frontend-blueprint) (Angular 21 + Module Federation).

## Key conventions (non-negotiable)

- Thin controllers — delegate to library services, no business logic in apps/
- Prisma only in repositories — never in services or controllers
- Never import/export foreign repositories — use application services
- `class-validator` DTOs with `@ApiProperty()` and definite assignment (`!:`)
- Global ValidationPipe: `whitelist: true`, `forbidNonWhitelisted: true`
- Five patterns: A (DDD), B (2-layer), D (cross-cutting), E (flat), F (app-layer thin)
- Guard pipeline: `JwtAuthGuard → OrgContextGuard → RBACGuard`
- RBAC: `@RequirePermissions()` + `@OrgScoped()` — Redis-cached (10 min TTL)
- Dual audit: `activityLog.logActivity()` + `legalAudit.recordEvent()` on every CUD
- Two-database design: business DB + immutable legal audit DB
- Domain events via `EventBusService` (local + SQS)
- Tests: Vitest 4, co-located `.spec.ts`, mock all deps in unit tests, real DB for integration
- Security: Auth0 RS256 JWT, OrgContextGuard for multi-tenancy, Helmet + CORS + rate limiting

## Commands

```sh
pnpm install
docker compose up -d postgres postgres-legal redis
npx prisma generate && npx prisma generate --config prisma.config.legal.ts
npx prisma migrate dev && npx prisma migrate dev --config prisma.config.legal.ts
npx nx serve api                     # API (port 3000)
npx nx serve worker-a                # SQS worker
npm run test:unit                    # Unit tests
npm run test:integration             # Integration tests
npx nx run-many -t lint --all        # Lint
```

## Where to find detail

| Topic                     | File                              |
| ------------------------- | --------------------------------- |
| Full Copilot instructions | `.github/copilot-instructions.md` |
| Architecture patterns     | `.claude/rules/architecture.md`   |
| Code style rules          | `.claude/rules/code-style.md`     |
| Testing rules             | `.claude/rules/testing.md`        |
| Security rules            | `.claude/rules/security.md`       |
| Contributing guide        | `CONTRIBUTING.md`                 |
