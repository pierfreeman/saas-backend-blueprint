# AGENTS.md — saas-backend-blueprint

> Loaded by Copilot and other VS Code agents as workspace context.
> Full instructions in `.github/copilot-instructions.md`. Rules in `.claude/rules/`.

---

## Project summary

Multi-tenant SaaS backend — **Nx 22**, **NestJS 11**, **Prisma 7**, **PostgreSQL × 2**.
Three apps: API (port 3000), Admin API (port 3001), SQS worker. 20+ shared libraries.
Frontend: [saas-frontend-blueprint](../saas-frontend-blueprint) (Angular 21 + Module Federation).

## Key conventions (non-negotiable)

- Thin controllers — delegate to library services, no business logic in apps/
- Prisma only in repositories — never in services or controllers
- Never import/export foreign repositories — use application services
- `class-validator` DTOs with `@ApiProperty()` and definite assignment (`!:`)
- Global ValidationPipe: `whitelist: true`, `forbidNonWhitelisted: true`
- Five patterns: A (DDD), B (2-layer), D (cross-cutting), E (flat), F (app-layer thin)
- Guard pipeline: `JwtAuthGuard → OrgContextGuard → RBACGuard` (tenant API) / `AdminJwtAuthGuard` (admin API)
- RBAC: `@RequirePermissions()` + `@OrgScoped()` — Redis-cached (10 min TTL)
- Dual audit: `activityLog.logActivity()` + `legalAudit.recordEvent()` on every CUD
- Two-database design: business DB + immutable legal audit DB
- Domain events via `EventBusService` (local + SQS)
- Tests: Vitest 4, co-located `.spec.ts`, mock all deps in unit tests, real DB for integration
- Security: Auth0 RS256 JWT, OrgContextGuard for multi-tenancy, Helmet + CORS + rate limiting

## Commands

```sh
npm install
docker compose up -d postgres postgres-legal redis
npx prisma generate && npx prisma generate --config prisma.config.legal.ts
npx prisma migrate dev && npx prisma migrate dev --config prisma.config.legal.ts
npx nx serve api                     # Tenant API (port 3000)
npx nx serve admin-api               # Admin API (port 3001)
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
