# saas-backend

An [Nx](https://nx.dev) monorepo with NestJS applications backed by two PostgreSQL databases (via Prisma), Redis (cache + pub/sub), and background workers.

## Architecture

```
apps/
  api          — HTTP API (NestJS, port 3000)
  api-e2e      — End-to-end tests for the API
  worker-a     — Background worker (polls SQS Standard queue, processes heavy jobs)
  worker-a-e2e — End-to-end tests for worker-a
libs/
  activity-log   — Tenant-visible operational event log (business DB, app_audit schema)
  legal-audit    — Immutable compliance event recorder (legal DB, ISO 27001 / GDPR)
  common         — Shared utilities: RBAC constants, tenant context, exception filter
  config         — NestJS ConfigModule wrappers (app, auth, database, redis)
  events         — EventBusService facade (LocalTransport / SQS), DomainEvent types, DOMAIN_EVENTS constants
  prisma-business — PrismaBusinessService (extends PrismaClient → business DB)
  prisma-legal    — PrismaLegalService (extends PrismaClient → legal audit DB)
  redis           — CacheService (key/value, DB 1) and PubSubService (pub/sub, DB 0)
prisma/
  schema.prisma        — Business DB schema (User, Organization, Membership, ActivityLog, Job)
  schema.legal.prisma  — Legal audit DB schema (AuditEvent — append-only)
  migrations/          — Business DB migration history
  migrations-legal/    — Legal audit DB migration history
```

### Infrastructure

| Service               | Image                                    | Default port |
| --------------------- | ---------------------------------------- | ------------ |
| PostgreSQL (business) | `postgres:17-alpine`                     | `5432`       |
| PostgreSQL (legal)    | `postgres:17-alpine`                     | `5433`       |
| Redis                 | `redis:7-alpine`                         | `6379`       |
| LocalStack            | `localstack/localstack:3`                | `4566`       |
| Migrate               | built from `apps/api/Dockerfile.migrate` | —            |
| API                   | built from `apps/api/Dockerfile`         | `3000`       |
| Worker A              | built from `apps/worker-a/Dockerfile`    | —            |

The project uses **two separate PostgreSQL instances**:

- **Business DB** (`DATABASE_URL`) — domain models: User, Organization, Membership, ActivityLog, Job.
- **Legal audit DB** (`LEGAL_AUDIT_DATABASE_URL`) — append-only compliance records: AuditEvent. This database is isolated so that compliance logs survive even if the business database is wiped or restored.

Migrations run as a one-shot service before the API starts. The migrate image is built independently from the API image — schema changes only rebuild the migrator, and app code changes only rebuild the API.

## Prerequisites

- Node.js ≥ 20
- Docker & Docker Compose v2
- `npm` (or `pnpm`)
- An Auth0 tenant — see **Authentication** section below

## Local development

### 1. Install dependencies

```sh
pnpm install
```

### 2. Start infrastructure

```sh
docker compose up -d postgres redis
```

### 3. Configure environment

Copy `.env.example` to `.env` and adjust if needed:

```sh
cp .env.example .env
```

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

| Variable                  | Default        | Description                                                     |
| ------------------------- | -------------- | --------------------------------------------------------------- |
| `PORT`                    | `3000`         | HTTP port the API listens on                                    |
| `NODE_ENV`                | `development`  | Runtime environment                                             |
| `POSTGRES_USER`           | `postgres`     | Postgres user (Docker Compose)                                  |
| `POSTGRES_PASSWORD`       | `postgres`     | Postgres password (Docker Compose)                              |
| `POSTGRES_DB`             | `saas_backend` | Postgres database name (Docker Compose)                         |
| `POSTGRES_PORT`           | `5432`         | Host port mapped to business Postgres                           |
| `LEGAL_POSTGRES_USER`     | `postgres`     | Legal Postgres user (Docker Compose)                            |
| `LEGAL_POSTGRES_PASSWORD` | `postgres`     | Legal Postgres password (Docker Compose)                        |
| `LEGAL_POSTGRES_DB`       | `saas_legal`   | Legal Postgres database name (Docker Compose)                   |
| `LEGAL_POSTGRES_PORT`     | `5433`         | Host port mapped to legal Postgres                              |
| `REDIS_PORT`              | `6379`         | Host port mapped to Redis (Docker Compose)                      |
| `API_PORT`                | `3000`         | Host port mapped to the API (Docker Compose)                    |
| `EVENT_BUS_TRANSPORT`     | `local`        | Event transport: `local` (EventEmitter) or `sqs`                |
| `SQS_STANDARD_QUEUE_URL`  | —              | SQS Standard queue URL (required when `sqs`)                    |
| `SQS_FIFO_QUEUE_URL`      | —              | SQS FIFO queue URL, must end in `.fifo` (required when `sqs`)   |
| `SQS_ENDPOINT_URL`        | —              | LocalStack endpoint, e.g. `http://localhost:4566` (dev/CI only) |

### 4. Run database migrations

Business database (uses `prisma.config.ts` — no `--schema` flag needed):

```sh
npx prisma migrate dev --name describe_your_change
```

Legal audit database (separate schema and migrations directory):

```sh
npx prisma migrate dev \
  --schema=prisma/schema.legal.prisma \
  --migrations-dir=prisma/migrations-legal \
  --name describe_your_change
```

### 5. Serve applications

```sh
# API
npx nx serve api

# Workers
npx nx serve worker-a
```

## Docker (full stack)

```sh
docker compose up --build
```

This starts Postgres, Redis, runs migrations (`apps/api/Dockerfile.migrate`), then starts the API and both workers.
Migrations, API, and workers are built from **separate Dockerfiles**, so changing app code does not rebuild the migrator image.

Workers (`worker-a`) poll the **SQS Standard queue** for `heavy.job.created` events and process them asynchronously. They expose no HTTP port. In local mode (`EVENT_BUS_TRANSPORT=local`) the in-process EventEmitter is used instead and no SQS infrastructure is required.

> **Daily workflow tip** — when the Prisma schema has not changed, skip the migrate service entirely:
>
> ```sh
> # Restart only the API
> docker compose up -d --no-deps --build api
>
> # Restart only the workers
> docker compose up -d --no-deps --build worker-a
> ```

To override defaults, set variables in a `.env` file:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=saas_backend
POSTGRES_PORT=5432
LEGAL_POSTGRES_USER=postgres
LEGAL_POSTGRES_PASSWORD=postgres
LEGAL_POSTGRES_DB=saas_legal
LEGAL_POSTGRES_PORT=5433
REDIS_PORT=6379
API_PORT=3000
```

---

## Authentication

The API uses **Auth0** as the identity provider. All protected endpoints require a JWT bearer token issued by your Auth0 tenant.

### Setup

1. Create an Auth0 API in the dashboard and set an audience (e.g. `https://api.your-app.com`).
2. Add to `.env`:
   ```dotenv
   AUTH0_DOMAIN=your-tenant.auth0.com
   AUTH0_AUDIENCE=https://api.your-app.com
   ```
3. Obtain a token (e.g. via Auth0's Machine-to-Machine or the SPA flow) and pass it as `Authorization: Bearer <token>`.

On first call to `GET /auth/me`, the user is upserted into the local database using the `sub` JWT claim as the unique key.

---

## RBAC — Role & Permission system

Authorization is **static** (no database-driven role/permission tables). Roles and their permissions are defined in `libs/common/src/rbac/`.

### Role hierarchy

```
OWNER > ADMIN > MEMBER > READ_ONLY
```

### Permission map

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

### Adding a new permission

1. Add the constant to `libs/common/src/rbac/permissions.constants.ts`.
2. Assign it to the appropriate roles in `libs/common/src/rbac/roles.constants.ts` (`ROLE_PERMISSIONS`).
3. Guard the endpoint with `@RequirePermissions([PERMISSIONS.YOUR_NEW_PERMISSION])`.

---

## Activity log

`@libs/activity-log` records **tenant-visible operational events** in the `app_audit.activity_logs` table of the business database.  
Every entry is scoped to an organisation and queryable by ADMIN/OWNER roles via `GET /organizations/:orgId/activity-log`.

Key design rules:

- All writes are fire-and-forget — failures are logged but never propagated.
- Logs are cascade-deleted when the owning organisation is deleted.
- Does **not** store IP addresses, user agents, or correlation IDs — those belong in the legal audit database.

```typescript
import { ActivityLogService } from '@libs/activity-log';

this.activityLogService.logActivity({
  orgId: org.id,
  actorId: user.id,
  actorRole: 'ADMIN',
  action: 'membership.role.changed',
  entityType: 'Membership',
  entityId: membership.id,
  metadata: { from: 'MEMBER', to: 'ADMIN' },
});
```

The `action` field uses dot-notation strings (e.g. `org.created`, `membership.role.changed`, `org.deleted`).  
`metadata` must **never** contain PII or credentials — sanitise before passing.

Activity log records are queryable by ADMIN and OWNER roles:

| Method | Path                                 | Description                               |
| ------ | ------------------------------------ | ----------------------------------------- |
| `GET`  | `/organizations/:orgId/activity-log` | Returns paginated activity log for an org |

---

## Legal audit trail

`@libs/legal-audit` records **immutable compliance events** in a **separate** legal audit PostgreSQL database.  
It satisfies ISO 27001:2022 A.8.15/A.8.16 and GDPR Art. 5(2)/Art. 30 accountability obligations.

Key design rules:

- Strictly append-only — no UPDATE or DELETE operations, ever.
- Records persist after organisation deletion (no FK constraint, no cascade).
- All writes are fire-and-forget — failures are swallowed internally.
- **Not queryable via the public API** — direct DB access by authorised personnel / SIEM tooling only.
- Must not store raw PII — callers must sanitise before calling.
- Completely independent of `ActivityLogModule`.

```typescript
import { LegalAuditService } from '@libs/legal-audit';

this.legalAuditService.recordEvent({
  eventType: 'org.created',
  orgId: org.id,
  actorRole: 'OWNER',
  triggerType: 'user_action',
  metadata: { orgName: org.name },
});
```

Valid `triggerType` values: `'user_action'` | `'system'` | `'api'` | `'scheduler'`.

### Two-database separation

| Database       | Library                 | Prisma schema                | ENV var                    |
| -------------- | ----------------------- | ---------------------------- | -------------------------- |
| Business DB    | `@libs/prisma-business` | `prisma/schema.prisma`       | `DATABASE_URL`             |
| Legal audit DB | `@libs/prisma-legal`    | `prisma/schema.legal.prisma` | `LEGAL_AUDIT_DATABASE_URL` |

`PrismaBusinessService` and `PrismaLegalService` each extend their own generated `PrismaClient` (from `@prisma/client` and `@prisma/legal-client` respectively), ensuring no accidental cross-contamination between the two databases.

---

## Async jobs (SQS + persistence)

The full lifecycle of a heavy job:

```
POST /tasks/heavy-job
   │
   ├─ prisma.job.create (status: PENDING)   ← immediately queryable
   └─ EventBusService.publish → SQS queue
                                    │
                              Worker polls SQS
                                    │
                    ┌───────────────┴────────────────┐
                    │                                │
              job.update(PROCESSING)          job.update(DONE|FAILED)
              pubSub.publish(job:update:*)    pubSub.publish(job:update:*)
                    │                                │
              JobsGateway                     JobsGateway
         (pattern-subscribes Redis)      emits "job:update" to socket rooms
                    │
              WebSocket clients
```

### Job state machine

```
PENDING → PROCESSING → DONE
                     ↘ FAILED
```

Each transition writes to the `jobs` table **and** publishes a `JobUpdateMessage`
to the Redis channel `job:update:{tenantId}`, which the `JobsGateway` fans out
to connected WebSocket clients.

### REST endpoints

| Method | Path               | Description                                   |
| ------ | ------------------ | --------------------------------------------- |
| `POST` | `/tasks/heavy-job` | Create and enqueue a job; returns `{ jobId }` |
| `GET`  | `/tasks/:jobId`    | Poll current job status (for non-WS clients)  |

### Adding a new job type

1. Add the new constant to `DOMAIN_EVENTS` in `libs/events/src/constants/event-routing.constants.ts`.
2. Create a PENDING row in `jobs` before publishing (see `TasksService.createHeavyJob`).
3. Publish from the API via `EventBusService.publish({ eventType: DOMAIN_EVENTS.YOUR_EVENT, payload, tenantId })`.
4. Handle in the relevant worker's `SqsConsumerService.dispatch()` switch.
5. In the worker handler, update the job row and publish a `JobUpdateMessage` to Redis.

Event names and payload interfaces are defined in `libs/events/src/constants/event-routing.constants.ts`.
See [libs/events/README.md](libs/events/README.md) for the full reference.

---

## Real-time notifications (WebSocket)

The API exposes a Socket.IO server for real-time job status updates.

### Connection

```
wss://your-api/jobs
```

Pass the Auth0 JWT in one of three ways (checked in order):

```javascript
// 1. Socket.IO auth option (recommended)
const socket = io('http://localhost:3000/jobs', {
  auth: { token: 'Bearer <jwt>' },
});

// 2. Query parameter
const socket = io('http://localhost:3000/jobs?token=Bearer%20<jwt>');

// 3. Authorization header (not available in browsers)
```

### Rooms

On successful connection the gateway automatically joins the client to:

| Room                | Receives                                |
| ------------------- | --------------------------------------- |
| `user:{userId}`     | Updates for jobs submitted by that user |
| `tenant:{tenantId}` | All job updates within the organisation |

### Emitted events

| Event        | Payload            | Description                         |
| ------------ | ------------------ | ----------------------------------- |
| `job:update` | `JobUpdateMessage` | Fired on every job state transition |

```typescript
import { JobUpdateMessage } from '@libs/events';

socket.on('job:update', (msg: JobUpdateMessage) => {
  console.log(msg.jobId, msg.status); // 'PROCESSING' | 'DONE' | 'FAILED'
});
```

See `libs/events/src/interfaces/job-update-message.interface.ts` for the full
`JobUpdateMessage` type.

---

## Common Nx tasks

```sh
# Build
npx nx build api

# Test
npx nx test api
npx nx run-many -t test

# Test with coverage
npx nx test api --coverage

# Lint
npx nx lint api
npx nx run-many -t lint

# Visualise project graph
npx nx graph

# Show all targets for a project
npx nx show project api
```

### Swagger / OpenAPI

When the API is running, the interactive docs are available at:

```
http://localhost:3000/docs
```

### Prisma Studio (database browser)

Business database:

```sh
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_backend"
npx prisma studio
```

Legal audit database:

```sh
$env:LEGAL_AUDIT_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/saas_legal"
npx prisma studio --schema=prisma/schema.legal.prisma
```

### Prisma migration (local development)

Business database (`prisma.config.ts` is picked up automatically):

```sh
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_backend"
npx prisma migrate dev --name describe_your_change
```

Legal audit database:

```sh
$env:LEGAL_AUDIT_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/saas_legal"
npx prisma migrate dev \
  --schema=prisma/schema.legal.prisma \
  --migrations-dir=prisma/migrations-legal \
  --name describe_your_change
```

> **Prisma config** — `prisma.config.ts` at the workspace root configures the business-database defaults (schema path, migrations directory, datasource URL). The legal schema always requires explicit `--schema` and `--migrations-dir` flags because it uses a second datasource (`LEGAL_AUDIT_DATABASE_URL`) that is not covered by `prisma.config.ts`.

## Adding projects

```sh
# New NestJS app
npx nx g @nx/nest:app my-app

# New shared library
npx nx g @nx/node:lib my-lib
```

### Adding a new shared library — checklist

1. Generate: `npx nx g @nx/node:lib my-lib`
2. Export the public API through `libs/my-lib/src/index.ts`
3. Register the path alias in `tsconfig.base.json`:
   ```json
   "@libs/my-lib": ["libs/my-lib/src/index.ts"]
   ```
4. Write a `README.md` in `libs/my-lib/` documenting purpose, public API, and usage examples.

## CI

The workspace ships a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs lint, test, and build on affected projects. Connect to Nx Cloud for remote caching and distributed task execution:

```sh
npx nx connect
```
