# Contributing Guide

This document is the primary reference for adding new components — libraries or apps — to this monorepo. It targets both human developers and AI coding agents acting on this codebase.

Read this before writing any code. The architecture is intentional and enforced. Deviating from the patterns documented here will be caught in code review (and, for some rules, by ESLint).

---

## Table of Contents

1. [Monorepo overview](#1-monorepo-overview)
2. [Five architectural patterns](#2-five-architectural-patterns)
3. [Decision tree: which pattern to use?](#3-decision-tree-which-pattern-to-use)
4. [Adding a new library](#4-adding-a-new-library)
5. [Adding a new app](#5-adding-a-new-app)
6. [Invariants and hard rules](#6-invariants-and-hard-rules)
7. [Testing conventions](#7-testing-conventions)
8. [Running the project locally](#8-running-the-project-locally)
9. [Anti-patterns reference](#9-anti-patterns-reference)

---

## 1. Monorepo overview

```
saas-backend-blueprint/
├── apps/
│   ├── api/           ← NestJS HTTP server
│   ├── api-e2e/       ← Integration test suite
│   ├── worker-a/      ← SQS async job worker
│   └── worker-a-e2e/
├── libs/              ← All shared domain and infrastructure libraries
├── prisma/
│   ├── schema.prisma        ← Business DB: generator + datasource only
│   ├── user.prisma          ← User model
│   ├── organization.prisma  ← Organization, enums
│   ├── membership.prisma    ← Membership, enums
│   ├── activity-log.prisma  ← ActivityLog
│   ├── billing.prisma       ← BillingEvent, SubscriptionSnapshot
│   ├── notification.prisma  ← Notification
│   ├── file.prisma          ← File, enums
│   ├── job.prisma           ← Job, OrgExport, enums
│   └── planning.prisma      ← Event, EventAttendee, EventException, enums
├── prisma-legal/
│   └── schema.prisma        ← Legal audit DB (separate connection)
└── scripts/           ← LocalStack + migration helpers
```

**Stack:** Nx · NestJS · TypeScript · Prisma · PostgreSQL · Redis · SQS (LocalStack in dev).

**Rule of thumb:** business logic lives in `libs/`. Apps (`apps/`) are thin orchestration layers — controllers, DTOs, module wiring. If you find yourself writing business logic in an app, extract it to a library instead.

---

## 2. Five architectural patterns

Every library in this codebase belongs to exactly one of five patterns. Learning to read them is the first step before contributing.

---

### Pattern A — Full 3-layer DDD

Use when the library has an **external integration boundary** (third-party API, cloud service) or when you need to invert a dependency via a port/adapter interface.

**Folder structure:**

```
libs/{name}/src/
  application/
    services/           ← orchestration; injects repositories and other lib services
    event-handlers/     ← optional; domain event consumers
  domain/
    entities/           ← rich types / interfaces (not ORM models)
    enums/
    ports/              ← interfaces that infrastructure must implement
  infrastructure/
    repositories/       ← ONLY place for Prisma calls; single-aggregate
    clients/            ← raw SDK wrappers (e.g. S3Client, StripeClient)
    providers/          ← implement domain ports (e.g. S3Provider implements IStorageProvider)
  {name}.module.ts
  index.ts              ← public API; NEVER exports repositories or infrastructure
```

**Real example — `@libs/storage`:**

```
libs/storage/src/
  application/services/storage.service.ts
  application/services/upload-policy.service.ts
  domain/entities/storage-provider.interface.ts   ← IStorageProvider port
  domain/enums/storage.enums.ts
  domain/types.ts
  infrastructure/clients/s3.client.ts
  infrastructure/providers/s3.provider.ts         ← implements IStorageProvider
  infrastructure/repositories/storage.repository.ts
  storage.module.ts
  index.ts
```

**`storage.module.ts`** (module wiring):

```typescript
@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    ActivityLogModule,
    LegalAuditModule,
  ],
  providers: [
    S3StorageClient,
    S3Provider,
    StorageRepository,
    StorageService,
    UploadPolicyService,
  ],
  exports: [StorageService, UploadPolicyService], // ← never export repositories
})
export class StorageModule {}
```

**`index.ts`** (public barrel):

```typescript
export * from './storage.module';
export * from './application/services/storage.service';
export * from './application/services/upload-policy.service';
export * from './domain/types';
export * from './domain/enums/storage.enums';
export * from './domain/entities/storage-provider.interface';
// StorageRepository is NOT exported
```

**Currently using Pattern A:** `@libs/billing`, `@libs/storage`.

---

### Pattern B — 2-layer (application + infrastructure)

Use when the library owns a **well-scoped domain aggregate** with a stable database schema and no external integration boundary.

**Folder structure:**

```
libs/{name}/src/
  application/
    services/          ← orchestration; injects own repository + other lib services
    event-handlers/    ← optional; place domain event handlers here if no HTTP coupling
  infrastructure/
    repositories/      ← ONLY place for Prisma calls; single-aggregate
  {name}.module.ts
  index.ts             ← exports module + service(s) ONLY; never repositories
```

**Real example — `@libs/jobs`:**

```typescript
// libs/jobs/src/application/services/job.service.ts
@Injectable()
export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  async create(
    jobId: string,
    orgId: string,
    type: string,
    payload: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    return this.jobRepository.create(jobId, orgId, type, payload, userId);
  }

  async findByIdAndOrg(jobId: string, orgId: string): Promise<Job> {
    return this.jobRepository.findByIdAndOrg(jobId, orgId);
  }

  async markProcessing(jobId: string): Promise<void> {
    return this.jobRepository.markProcessing(jobId);
  }

  async markDone(
    jobId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    return this.jobRepository.markDone(jobId, result);
  }
  // ...
}
```

```typescript
// libs/jobs/src/jobs.module.ts
@Module({
  imports: [PrismaBusinessModule],
  providers: [JobRepository, JobService],
  exports: [JobService], // ← JobRepository stays internal
})
export class JobsModule {}
```

```typescript
// libs/jobs/src/index.ts
export * from './jobs.module';
export * from './application/services/job.service';
// JobRepository is NOT exported
```

**Currently using Pattern B:** `@libs/memberships`, `@libs/organizations`, `@libs/users`, `@libs/jobs`, `@libs/notifications`, `@libs/org-deletion`, `@libs/org-export`.

---

### Pattern D — Cross-cutting construct-type grouping

Use when the library provides **infrastructure or framework-level constructs** (guards, interceptors, middleware, decorators, services) that have no domain semantics and could be consumed by any app.

**Folder structure:**

```
libs/{name}/src/
  guards/
  interceptors/
  middleware/
  services/
  decorators/
  {name}.module.ts
  index.ts          ← exports all public constructs
```

There is no `application/`, `domain/`, or `infrastructure/` split — these constructs are the public surface.

**Real example — `@libs/rbac`:**

```typescript
// libs/rbac/src/index.ts
export * from './rbac.module';
export * from './services/rbac.service';
export * from './services/rbac-cache.service';
export * from './services/permission-resolver.service';
export * from './guards/org-context.guard';
export * from './guards/rbac.guard';
export * from './decorators/org-scoped.decorator';
export * from './decorators/require-permissions.decorator';
// ...
```

**Currently using Pattern D:** `@libs/rbac`, `@libs/security`, `@libs/observability`, `@libs/common`.

---

### Pattern E — Flat single-concern library

Use for **low-complexity, single-responsibility utilities** that provide one or two services and have minimal internal structure.

**Folder structure:**

```
libs/{name}/src/
  {name}.module.ts
  {name}.service.ts
  index.ts
```

Add sub-folders only if the library grows and genuinely needs them. Do not pre-optimize structure.

**Currently using Pattern E:** `@libs/events`, `@libs/email`, `@libs/redis`, `@libs/activity-log`, `@libs/legal-audit`, `@libs/prisma-business`, `@libs/prisma-legal`, `@libs/config`.

---

### Pattern F — App-layer feature module (thin)

Use within an **app** (`apps/api`, `apps/worker-a`) to wire library services into NestJS. This is not a library pattern — it is the app-side complement.

**Folder structure:**

```
apps/{app}/src/app/{feature}/
  {feature}.module.ts     ← imports lib modules, provides controller
  {feature}.controller.ts ← delegates directly to lib services; no business logic
  dto/
    create-{resource}.dto.ts
    update-{resource}.dto.ts
```

**What must NOT be here:**

- Services that contain business logic (extract to `libs/` instead)
- Repository injections from external libs
- Domain event handlers

**Real example — `apps/api/src/app/memberships/`:**

```typescript
// memberships.controller.ts
@Controller('organizations/:orgId/memberships')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_INVITE])
  async create(@Body() dto: CreateMembershipDto): Promise<Membership> {
    return this.membershipsService.create(/* ... */);
  }
  // All methods delegate to MembershipsService; no logic here
}
```

**Threshold rule:** if a feature module grows beyond a controller + DTOs + module wiring (e.g. a service with more than 3 non-trivial methods), extract it to a new library.

---

## 3. Decision tree: which pattern to use?

Follow this decision tree top-to-bottom:

```
Are you adding something inside an app (apps/api or apps/worker-a)?
  └─ YES → Use Pattern F (thin feature module).
           If you need business logic, create a lib and reference it from the app.

Are you creating a shared library?
  ├─ Does it wrap a third-party service (Stripe, S3, Resend, SQS...)?
  │    └─ YES → Pattern A (3-layer DDD with port/adapter)
  │
  ├─ Does it own a domain aggregate that is persisted in the database?
  │    └─ YES → Pattern B (2-layer: application + infrastructure)
  │
  ├─ Does it provide framework constructs (guards, interceptors, decorators)
  │  with no domain semantics?
  │    └─ YES → Pattern D (cross-cutting construct-type grouping)
  │
  └─ Is it a focused utility with a single module and service?
       └─ YES → Pattern E (flat)
```

When in doubt between Pattern A and B: does the library need to hide a dependency behind a plug-replaceable interface (`IEmailProvider`, `IStorageProvider`)? If yes → Pattern A. Otherwise → Pattern B.

---

## 4. Adding a new library

### Step 1 — Generate the Nx library

```bash
npx nx g @nx/nest:library {name} --directory=libs/{name} --importPath=@libs/{name}
```

This creates the base structure and registers the path alias `@libs/{name}` in `tsconfig.base.json`.

### Step 2 — Build the internal structure

Delete the generated boilerplate and create the structure for your chosen pattern (A, B, D, or E) as documented in §2.

**For Pattern B (most common):** create:

```
libs/{name}/src/
  application/
    services/{name}.service.ts
  infrastructure/
    repositories/{name}.repository.ts
  {name}.module.ts
  index.ts
```

### Step 3 — Write the module

Wire everything inside `{name}.module.ts`. Follow these rules:

- `imports`: other lib modules you depend on (e.g. `PrismaBusinessModule`, `EmailModule`)
- `providers`: all internal services and repositories
- `exports`: **only application services** — never repositories

```typescript
@Module({
  imports: [PrismaBusinessModule],
  providers: [{Name}Repository, {Name}Service],
  exports: [{Name}Service],
})
export class {Name}Module {}
```

### Step 4 — Write the barrel (`index.ts`)

Expose only what consumers need. Never expose infrastructure internals.

```typescript
// index.ts
export * from './{name}.module';
export * from './application/services/{name}.service.ts';
// Export domain types if you have a domain/ layer (Pattern A)
// Do NOT export repositories, clients, or providers
```

### Step 5 — Write the repository (if applicable)

The repository is the only place Prisma is called. Each repository owns **one aggregate** (one primary Prisma model). Multi-aggregate coordination belongs in application services, not repositories.

```typescript
@Injectable()
export class {Name}Repository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findById(id: string): Promise<{Name}> {
    return this.prisma.{name}.findUniqueOrThrow({ where: { id } });
  }
}
```

### Step 6 — Write the service

The service is the public orchestration point. It injects its own repository and any other library **services** (never foreign repositories).

```typescript
@Injectable()
export class {Name}Service {
  constructor(
    private readonly {name}Repository: {Name}Repository,
    private readonly emailService: EmailService,   // ← other lib services are OK
  ) {}

  async doSomething(id: string): Promise<{Name}> {
    const entity = await this.{name}Repository.findById(id);
    await this.emailService.send(/* … */);
    return entity;
  }
}
```

### Step 7 — Add domain event handlers (if needed)

If your library reacts to domain events published by `@libs/events`, add handlers in `application/event-handlers/`. Register them as `providers` in your module (but do not add them to `exports`).

```typescript
// libs/{name}/src/application/event-handlers/something-happened.handler.ts
@Injectable()
export class SomethingHappenedHandler {
  constructor(private readonly emailService: EmailService) {}

  async handle(event: DomainEvent<SomethingHappenedPayload>): Promise<void> {
    // React to the event; use only services injected via DI
  }
}
```

Real example of an event handler: [libs/memberships/src/application/event-handlers/user-invited-email.handler.ts](libs/memberships/src/application/event-handlers/user-invited-email.handler.ts).

### Step 8 — Wire into the consuming app

In the app that needs your library, add it to the relevant feature module:

```typescript
// apps/api/src/app/{feature}/{feature}.module.ts
@Module({
  imports: [{Name}Module],
  controllers: [{Feature}Controller],
})
export class {Feature}Module {}
```

Inject the service into the controller:

```typescript
// apps/api/src/app/{feature}/{feature}.controller.ts
@Controller('{feature}')
export class {Feature}Controller {
  constructor(private readonly {name}Service: {Name}Service) {}

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.{name}Service.findById(id);
  }
}
```

### Step 9 — Write co-located specs

Every `.ts` file with testable logic must have a `.spec.ts` sibling. No `tests/` directories are allowed.

```
libs/{name}/src/application/services/{name}.service.ts
libs/{name}/src/application/services/{name}.service.spec.ts   ← co-located
libs/{name}/src/infrastructure/repositories/{name}.repository.ts
libs/{name}/src/infrastructure/repositories/{name}.repository.spec.ts
```

### Step 10 — Add a Prisma migration (if you added a new model)

If your library introduces a new Prisma model, add a new `.prisma` file under `prisma/` (e.g. `prisma/my-model.prisma`) or extend an existing one:

```bash
# Re-generate the client after editing the schema
npx prisma generate

# Create the migration
npx prisma migrate dev --name add_{name}_model
```

---

## 5. Adding a new app

Apps are rare — most features go into `libs/` or new feature modules inside existing apps.

Create a new app when you need an **independent runtime process** (e.g. a new async worker, a scheduled task runner, a separate HTTP service for a different port).

### Step 1 — Generate the Nx app

```bash
npx nx g @nx/nest:app {app-name} --directory=apps/{app-name}
```

### Step 2 — Keep the app thin

The app owns:

- `main.ts` — bootstrap
- `app.module.ts` — imports lib modules, registers the app
- Feature modules (Pattern F): controller + DTOs only

The app must not own:

- Repositories
- Business logic services
- Domain event handlers

All shared behaviour must be extracted to `libs/`.

### Step 3 — Reference the correct lib modules

Import lib modules in your `app.module.ts`:

```typescript
@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    {Name}Module,            // ← your domain lib
    RBACModule,              // ← if auth/authorization is needed
  ],
})
export class AppModule {}
```

### Step 4 — Add Dockerfile and Nx project config

Copy the structure from `apps/worker-a/Dockerfile` as a reference for async workers, or `apps/api/Dockerfile` for HTTP servers.

Register the app in `nx.json` and create `project.json` following the existing apps as a template.

---

## 6. Invariants and hard rules

These rules are non-negotiable. All are verified by automated checks (ESLint or grep audit in CI).

### Rule 1 — Never import a repository from a foreign library

```typescript
// ❌ WRONG — RBACService importing an external repository
import { UserRepository } from '@libs/users';

// ✅ CORRECT — import the application service
import { UsersService } from '@libs/users';
```

If the service you need does not expose the method you need, add the method to the application service — do not shortcut to the repository.

### Rule 2 — Never export a repository from a barrel or NestJS module exports

```typescript
// ❌ WRONG
// {name}.module.ts
exports: [{Name}Service, {Name}Repository]

// ❌ WRONG
// index.ts
export * from './infrastructure/repositories/{name}.repository';

// ✅ CORRECT
// {name}.module.ts
exports: [{Name}Service]

// ✅ CORRECT
// index.ts
export * from './application/services/{name}.service';
```

### Rule 3 — Domain event handlers with no HTTP coupling belong in libs, not in apps

```
❌  apps/api/src/app/memberships/event-handlers/user-invited-email.handler.ts
✅  libs/memberships/src/application/event-handlers/user-invited-email.handler.ts
```

The domain lib owns its side effects. The app layer should not know about email delivery.

### Rule 4 — Repository methods are single-aggregate

A repository accesses one Prisma model. If an operation requires coordination across multiple aggregates (e.g. create User + create Organization + create Membership atomically), that coordination belongs in an **application service**, not a repository.

The one accepted exception is `UserRepository.provisionWithPersonalOrg()`, which uses `$transaction` for atomicity and is documented inline. This exception will not be extended.

### Rule 5 — App-layer modules contain no business logic

Controllers must delegate immediately to library services. A service inside an app is only acceptable if it is very low complexity (≤ 3 non-trivial methods, no Prisma calls) and it is clearly transitional pending extraction.

### Rule 6 — Prisma is not importable across library boundaries

`PrismaBusinessService` and `PrismaLegalService` can only be used inside `@libs/prisma-business` and `@libs/prisma-legal`, or in a library's own repository class. ESLint rules enforce this. The one approved exception is `health.service.ts` (raw connectivity probe).

---

## 7. Testing conventions

### Co-location

Every source file has its spec file alongside it:

```
{name}.service.ts
{name}.service.spec.ts   ← always in the same directory
```

No `tests/` or `__tests__/` directories anywhere in the codebase.

### Running tests

```bash
# All projects
npx nx run-many --target=test --all

# Single library
npx nx test {name}

# Single app
npx nx test api

# With coverage
npx nx run-many --target=test --all --coverage
```

### Writing specs

Use Vitest. Mock all injected dependencies with `vi.fn()`. Do not use real Prisma in unit tests — mock the repository instead.

```typescript
// Example: testing a service with a mocked repository
describe('JobService', () => {
  let service: JobService;
  const mockRepository = {
    create: vi.fn(),
    findByIdAndOrg: vi.fn(),
    markDone: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        JobService,
        { provide: JobRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(JobService);
  });

  it('delegates create to the repository', async () => {
    await service.create('id', 'orgId', 'TYPE', {});
    expect(mockRepository.create).toHaveBeenCalledWith(
      'id',
      'orgId',
      'TYPE',
      {},
      undefined,
    );
  });
});
```

### Linting

```bash
npx nx run-many --target=lint --all
```

Expected baseline: 0 errors. The 110 pre-existing `@typescript-eslint/no-non-null-assertion` warnings are not regressions — do not suppress new ones.

---

## 8. Running the project locally

**Prerequisites:** Docker, Node.js ≥ 20.19.0, `pnpm` (or `npm`).

```bash
# Start infrastructure (Postgres, Redis, LocalStack/SQS)
docker compose up -d postgres postgres-legal redis

# Install dependencies
npm install

# Generate Prisma clients (required on first clone and after schema changes)
npx prisma generate
npx prisma generate --config prisma.config.legal.ts

# Run database migrations
npx prisma migrate dev
npx prisma migrate dev --config prisma.config.legal.ts

# Start the API in development mode
npx nx serve api

# Start the worker in development mode
npx nx serve worker-a
```

**Integration / e2e tests:**

```bash
docker compose -f docker-compose.test.yml up -d
npx nx test api-e2e
npx nx test worker-a-e2e
```

---

## 9. Anti-patterns reference

The following patterns existed in earlier versions of this codebase and have been deliberately eliminated. Do not reintroduce them.

| Anti-pattern                                    | Example                                                                  | Why it is wrong                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Importing a foreign repository                  | `RBACService` → `MembershipsRepository`                                  | Bypasses the domain boundary; couples RBAC internals to the Memberships schema   |
| Exporting a repository from a module or barrel  | `exports: [MembershipsRepository]`                                       | Invites consumers to bypass the application service layer                        |
| Zero-value application service wrapper          | Service with one method that calls a single other method, adding nothing | Indirection without encapsulation; delete it and use an honest exception instead |
| Business logic services in `apps/`              | `apps/api/src/app/rbac/services/rbac.service.ts`                         | Not reusable; couples logic to one HTTP server                                   |
| Domain event handlers in HTTP layer             | `apps/api/.../memberships/event-handlers/`                               | Email delivery is a domain concern, not an HTTP concern                          |
| App service bypassing a lib's application layer | `FeatureFlagsService` → `BillingRepository`                              | Couples feature flag logic to Billing schema details                             |
| Orphaned dead code after lib extraction         | Files remaining in `apps/api/src/app/rbac/` after RBAC was extracted     | Increases cognitive load; always delete replaced files                           |
| Guard injecting a foreign repository            | `OrgContextGuard` → `UserRepository`                                     | Couples a reusable guard to one lib's infrastructure                             |
| Worker injecting a repository directly          | `WorkerController` → `JobRepository`                                     | The worker should use `JobService`; repositories are private                     |

---

## Quick-reference checklist

Use this when opening a PR for a new library or app:

- [ ] Correct pattern chosen (A / B / D / E / F) per the decision tree
- [ ] `{name}.module.ts` exports services only — no repositories in `exports[]`
- [ ] `index.ts` exports no repositories or infrastructure internals
- [ ] No imports of foreign repositories anywhere in the lib
- [ ] All business logic is in `libs/`, not in `apps/`
- [ ] Domain event handlers live in `libs/`, not in `apps/`
- [ ] Every source file has a co-located `.spec.ts`
- [ ] No `tests/` or `__tests__/` directories created
- [ ] `npx nx run-many --target=test --all` passes with 0 failures
- [ ] `npx nx run-many --target=lint --all` passes with 0 errors
