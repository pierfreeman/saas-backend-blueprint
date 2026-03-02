# @libs/prisma

Thin NestJS wrapper around Prisma Client. Provides `PrismaService` — a singleton that extends `PrismaClient` directly, exposing all generated model accessors (`this.user`, `this.organization`, …) as first-class properties.

---

## Usage

### 1. Import `PrismaModule`

```typescript
import { PrismaModule } from '@libs/prisma';

@Module({
  imports: [PrismaModule],
})
export class FeatureModule {}
```

`PrismaModule` is **global** (`@Global()`) — import it once in `AppModule`. All other modules can inject `PrismaService` without re-importing the module.

### 2. Inject and use

```typescript
import { PrismaService } from '@libs/prisma';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id } });
  }
}
```

---

## Connection lifecycle

| Hook              | Behaviour                                   |
| ----------------- | ------------------------------------------- |
| `onModuleInit`    | Calls `$connect()` and logs the outcome     |
| `onModuleDestroy` | Calls `$disconnect()` for graceful shutdown |

Graceful shutdown requires `app.enableShutdownHooks()` in `main.ts` (already enabled).

---

## Prisma development workflow

### Edit the schema

All Prisma models live in `prisma/schema.prisma`.

### Create and apply a migration (local Docker Postgres)

```sh
# Point directly at the Docker Postgres container
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_backend"
npx prisma migrate dev --name describe_your_change
```

This will:

1. Generate a SQL migration file under `prisma/migrations/`
2. Apply it to the local database
3. Regenerate `@prisma/client`

### Regenerate client without migrating

```sh
npx prisma generate
```

### Inspect the database with Prisma Studio

```sh
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_backend"
npx prisma studio
```

### Reset the local database (⚠ destructive)

```sh
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/saas_backend"
npx prisma migrate reset
```

---

## Production migrations

In Docker Compose, migrations are applied by the dedicated `migrate` service (`apps/api/Dockerfile.migrate`) which runs `prisma migrate deploy` before the API starts. This ensures migrations are applied atomically and never block application startup.

---

## Logging

`PrismaService` registers Prisma's `query`, `error`, and `warn` log levels as events. They are forwarded to NestJS `Logger` automatically.

To enable verbose query logging in development, set:

```dotenv
DATABASE_LOG_QUERIES=true
```

---

## Nx tasks

```sh
npx nx build prisma   # compile the library
npx nx test prisma    # run unit tests
npx nx lint prisma    # lint
```
