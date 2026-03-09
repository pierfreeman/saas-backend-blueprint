# @libs/prisma-legal

`PrismaLegalService` — the single injectable gateway to the legal audit PostgreSQL database. Extends `PrismaClient` from `@prisma/legal-client` (a separately generated client), ensuring complete isolation from the business database.

---

## Models

Defined in `prisma/schema.legal.prisma`:

| Model        | Description                                              |
| ------------ | -------------------------------------------------------- |
| `AuditEvent` | Append-only compliance record — never updated or deleted |

---

## Constraints

These constraints are enforced at the application layer and must be respected by every caller:

- **No UPDATE statements.** Never call `.update()` or `.updateMany()` on this service.
- **No DELETE statements.** Records must persist indefinitely, including after org deletion.
- **No `cleanDatabase()` method.** The legal DB is never wiped, not even in tests (test isolation is achieved by writing distinct `orgId` values per test run).
- The production database role must have **INSERT-only** permissions on `audit_events`.

---

## Usage

`PrismaLegalService` is only used internally by `@libs/legal-audit`. You should not inject it directly outside of that library — go through `LegalAuditService` instead.

If you need direct access for a migration script or SIEM export, import `PrismaLegalModule`:

```typescript
import { PrismaLegalModule } from '@libs/prisma-legal';

@Module({ imports: [PrismaLegalModule] })
export class ComplianceModule {}
```

---

## Configuration

Reads `database.legalAuditUrl` from `ConfigService` (falls back to `LEGAL_AUDIT_DATABASE_URL` env var).

| Variable                   | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `LEGAL_AUDIT_DATABASE_URL` | PostgreSQL connection string for the legal audit DB |

Migrations:

```sh
npx prisma migrate dev --config prisma.config.legal.ts
```
