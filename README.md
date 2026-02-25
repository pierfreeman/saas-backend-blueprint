# nx-nest

An [Nx](https://nx.dev) monorepo with NestJS applications backed by PostgreSQL (via Prisma), Redis (cache + pub/sub), and background workers.

## Architecture

```
apps/
  api          — HTTP API (NestJS)
  worker-a     — Background worker A
  worker-b     — Background worker B
libs/
  common       — Shared utilities and types
  prisma       — PrismaClient wrapper and service
  redis        — Redis cache (CacheService) and pub/sub (PubSubService)
prisma/
  schema.prisma — Database schema (User, Organization, …)
```

### Infrastructure

| Service    | Image                                    | Default port |
| ---------- | ---------------------------------------- | ------------ |
| PostgreSQL | `postgres:17-alpine`                     | `5432`       |
| Redis      | `redis:7-alpine`                         | `6379`       |
| Migrate    | built from `apps/api/Dockerfile.migrate` | —            |
| API        | built from `apps/api/Dockerfile`         | `3000`       |
| Worker A   | built from `apps/worker-a/Dockerfile`    | —            |
| Worker B   | built from `apps/worker-b/Dockerfile`    | —            |

Migrations run as a one-shot service before the API starts. The migrate image is built independently from the API image — schema changes only rebuild the migrator, and app code changes only rebuild the API.

## Prerequisites

- Node.js ≥ 20
- Docker & Docker Compose
- `pnpm` (or `npm`)

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

Add a `DATABASE_URL` pointing at the local Postgres instance, e.g.:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nx_nest
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 4. Run database migrations

```sh
npx nx run prisma:migrate-dev
```

### 5. Serve applications

```sh
# API
npx nx serve api

# Workers
npx nx serve worker-a
npx nx serve worker-b
```

## Docker (full stack)

```sh
docker compose up --build
```

This starts Postgres, Redis, runs migrations (`apps/api/Dockerfile.migrate`), then starts the API and both workers.
Migrations, API, and workers are built from **separate Dockerfiles**, so changing app code does not rebuild the migrator image.

Workers (`worker-a`, `worker-b`) are Redis microservices — they subscribe to `heavy.job.created` events and process them asynchronously. They expose no HTTP port.

> **Daily workflow tip** — when the Prisma schema has not changed, skip the migrate service entirely:
>
> ```sh
> # Restart only the API
> docker compose up -d --no-deps --build api
>
> # Restart only the workers
> docker compose up -d --no-deps --build worker-a worker-b
> ```

To override defaults, set variables in a `.env` file:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=nx_nest
POSTGRES_PORT=5432
REDIS_PORT=6379
API_PORT=3000
```

## Common Nx tasks

```sh
# Build
npx nx build api

# Test
npx nx test api
npx nx run-many -t test

# Lint
npx nx lint api
npx nx run-many -t lint

# Visualise project graph
npx nx graph

# Show all targets for a project
npx nx show project api
```

## Adding projects

```sh
# New NestJS app
npx nx g @nx/nest:app my-app

# New shared library
npx nx g @nx/node:lib my-lib
```

## CI

The workspace ships a GitHub Actions workflow (`.github/workflows/ci.yml`) that runs lint, test, and build on affected projects. Connect to Nx Cloud for remote caching and distributed task execution:

```sh
npx nx connect
```
