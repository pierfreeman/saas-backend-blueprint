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

| Service    | Image                            | Default port |
| ---------- | -------------------------------- | ------------ |
| PostgreSQL | `postgres:17-alpine`             | `5432`       |
| Redis      | `redis:7-alpine`                 | `6379`       |
| API        | built from `apps/api/Dockerfile` | `3000`       |

Prisma migrations run automatically as a one-shot `migrate` service before the API starts.

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

Copy `.env.docker` to `.env` and adjust if needed:

```sh
cp .env.docker .env
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

This starts Postgres, Redis, runs migrations, then starts the API. The API waits for both Postgres (healthy) and Redis (healthy) before launching.

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
