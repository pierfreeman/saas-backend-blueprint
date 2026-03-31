# Architecture Rules

Rules governing the structural patterns, layering, and library boundaries of this NestJS monorepo.

---

## Five architectural patterns

Every library belongs to exactly one pattern. Understand which you're working in before writing code.

| Pattern | Name                     | Location                                                   | Responsibility                                            |
| ------- | ------------------------ | ---------------------------------------------------------- | --------------------------------------------------------- |
| A       | Full 3-layer DDD         | `libs/{name}/` with domain/, application/, infrastructure/ | External integration (Stripe, S3), port/adapter interface |
| B       | 2-layer (app + infra)    | `libs/{name}/` with application/, infrastructure/          | Domain aggregate with stable DB schema                    |
| D       | Cross-cutting constructs | `libs/{name}/` with guards/, interceptors/, services/      | Framework-level, no domain semantics                      |
| E       | Flat single-concern      | `libs/{name}/` with module + service                       | Single-responsibility utility                             |
| F       | App-layer thin module    | `apps/{app}/src/app/{feature}/`                            | Controller + DTOs + module wiring only                    |

---

## Library layering

```
apps/  →  libs/ (application services)  →  libs/ (infrastructure/repositories)  →  Prisma
```

- **Apps** import lib **modules** and use **services** — never repositories.
- **Services** inject own repositories + other lib **services** — never foreign repositories.
- **Repositories** are private to their library — never exported.
- **Prisma** is only accessed inside repository classes (or `PrismaBusinessService`/`PrismaLegalService`).

---

## Pattern A — Full DDD

For libs with external integration boundaries (Stripe, S3, SendGrid).

```
libs/{name}/src/
  application/services/          ← orchestration
  domain/entities/               ← rich types / interfaces
  domain/ports/                  ← interfaces for infrastructure
  infrastructure/repositories/   ← Prisma calls
  infrastructure/clients/        ← raw SDK wrappers
  infrastructure/providers/      ← implement domain ports
  {name}.module.ts
  index.ts
```

**Currently**: `billing`, `storage`.

---

## Pattern B — 2-layer

For libs owning a domain aggregate with stable DB schema.

```
libs/{name}/src/
  application/services/          ← orchestration
  application/event-handlers/    ← domain event consumers (optional)
  infrastructure/repositories/   ← Prisma calls (single-aggregate)
  {name}.module.ts
  index.ts
```

**Currently**: `memberships`, `organizations`, `users`, `jobs`, `notifications`, `org-deletion`, `org-export`, `planning`.

---

## Pattern D — Cross-cutting

For framework constructs shared across the codebase.

```
libs/{name}/src/
  guards/
  interceptors/
  middleware/
  services/
  decorators/
  {name}.module.ts
  index.ts
```

**Currently**: `rbac`, `security`, `observability`, `common`.

---

## Pattern E — Flat

For single-responsibility utilities.

```
libs/{name}/src/
  {name}.module.ts
  {name}.service.ts
  index.ts
```

**Currently**: `events`, `email`, `redis`, `activity-log`, `legal-audit`, `prisma-business`, `prisma-legal`, `config`.

---

## Pattern F — App-layer thin module

Inside apps — controller + DTOs + module wiring. No business logic.

```
apps/{app}/src/app/{feature}/
  {feature}.module.ts
  {feature}.controller.ts
  dto/
    create-{resource}.dto.ts
    update-{resource}.dto.ts
```

**Threshold rule**: if a feature module grows beyond controller + DTOs + wiring (service with 3+ non-trivial methods), extract to a new lib.

---

## Decision tree: which pattern?

```
Adding inside an app (apps/api or apps/worker-a)?
  → Pattern F (thin feature module). Extract logic to libs/ if complex.

Creating a shared library?
  ├─ Wraps a third-party service (Stripe, S3, SendGrid)?
  │    → Pattern A (3-layer DDD with port/adapter)
  ├─ Owns a domain aggregate with stable DB schema?
  │    → Pattern B (2-layer: application + infrastructure)
  ├─ Provides framework constructs (guards, interceptors, decorators)?
  │    → Pattern D (cross-cutting)
  └─ Focused utility with single module + service?
       → Pattern E (flat)
```

---

## Hard rules (non-negotiable)

1. **Never import a foreign repository** — use the application service.
2. **Never export a repository** from module `exports[]` or `index.ts`.
3. **Domain event handlers belong in libs/** — not in apps/.
4. **Repository = single aggregate** — multi-aggregate coordination in services.
5. **App-layer = no business logic** — controllers delegate immediately.
6. **Prisma is not importable across library boundaries** — only in repositories.

---

## Adding new artifacts checklist

### New library

- [ ] Generated via `npx nx g @nx/nest:library {name} --directory=libs/{name} --importPath=@libs/{name}`
- [ ] Correct pattern chosen (A/B/D/E) per decision tree
- [ ] Module `exports[]` contains only application services
- [ ] `index.ts` exports no repositories or infrastructure internals
- [ ] Spec files co-located with every source file
- [ ] Prisma migration if new model added

### New app-layer feature (Pattern F)

- [ ] Controller + DTOs only, no business logic
- [ ] Delegates to library service
- [ ] DTOs with `class-validator` + `@ApiProperty()`
- [ ] Guards applied (`@UseGuards`, `@OrgScoped()`, `@RequirePermissions()`)
- [ ] Wired in app module `imports[]`
