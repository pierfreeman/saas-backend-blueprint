# @libs/prisma-business

`PrismaBusinessService` — the single injectable gateway to the business PostgreSQL database. Extends the generated `PrismaClient` (Prisma 7, ESM) so all model accessors (`this.user`, `this.organization`, `this.activityLog`, etc.) are available directly on the service instance. The client uses `@prisma/adapter-pg` (the official Node.js PostgreSQL driver adapter) instead of the legacy embedded Rust engine.

---

## Generated client

The Prisma client is generated into `libs/prisma-business/src/generated/prisma/` (gitignored). Run after every schema change or fresh clone:

```sh
npx prisma generate
```

Config is auto-detected from `prisma.config.ts` at the repo root.

---

## Models

Defined across `prisma/*.prisma` (multi-file schema):

| Model          | Description                                     |
| -------------- | ----------------------------------------------- |
| `User`         | Application user, keyed on Auth0 `sub`          |
| `Organization` | Multi-tenant unit; holds billing state          |
| `Membership`   | User ↔ Organization join with RBAC role         |
| `ActivityLog`  | Operational event log (`app_audit` schema)      |
| `Job`          | Async job record with lifecycle status tracking |
| `Notification` | In-app notification                             |

---

## Usage

Import `PrismaBusinessModule` in any module that needs database access:

```typescript
import { PrismaBusinessModule } from '@libs/prisma-business';

@Module({ imports: [PrismaBusinessModule] })
export class OrgsModule {}
```

Then inject `PrismaBusinessService` and use it like PrismaClient:

```typescript
constructor(private readonly prisma: PrismaBusinessService) {}

const org = await this.prisma.organization.findUniqueOrThrow({ where: { id } });
```

---

## Configuration

Reads `database.url` from `ConfigService` (falls back to `DATABASE_URL` env var). `ConfigModule` must be imported at the application root.

| Variable       | Description                                      |
| -------------- | ------------------------------------------------ |
| `DATABASE_URL` | PostgreSQL connection string for the business DB |

---

## Notes

- This is the **only** service that should access the business database. Do not instantiate `PrismaClient` from `@prisma/client` directly — import from `@libs/prisma-business` instead.
- For the legal audit database use [`@libs/prisma-legal`](../prisma-legal/README.md).
- The service logs slow queries and errors via NestJS `Logger` in development. Query logging is event-driven and does not affect production throughput.
- The client is pure JavaScript/TypeScript (no Rust binary) and is bundled by webpack into the app bundle — no `prisma generate` step is needed in the production Docker image.
