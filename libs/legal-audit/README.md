# @libs/legal-audit

Immutable compliance event recorder. Writes append-only records to a **separate** legal audit PostgreSQL database, isolated from the business database.

---

## Compliance guarantees

| Standard              | Obligation                             |
| --------------------- | -------------------------------------- |
| ISO 27001:2022 A.8.15 | Logging — tamper-evident audit records |
| ISO 27001:2022 A.8.16 | Monitoring — structured typed events   |
| GDPR Art. 5(2)        | Accountability — who did what, when    |
| GDPR Art. 30          | Records of processing activities       |

---

## Design constraints

- **Strictly append-only.** No UPDATE or DELETE operations. The production DB role should have INSERT-only permissions on the `audit_events` table.
- **Survives org deletion.** No FK constraint on `orgId` — records are never cascade-deleted.
- **Fire-and-forget writes.** `recordEvent()` never throws. Failures are caught internally so legal audit failures can never abort a business transaction.
- **No public API.** Records are not queryable through the HTTP API. Access is via direct DB credentials by authorised personnel or SIEM tooling only.
- **No PII.** Callers must sanitise before passing. The service stores opaque IDs only.
- **Independent of `@libs/activity-log`.** The two audit systems must never import each other.

---

## Usage

```typescript
import { LegalAuditService } from '@libs/legal-audit';

// Fire-and-forget — no await needed
this.legalAuditService.recordEvent({
  eventType: 'membership.role.changed',
  orgId: org.id,
  actorRole: 'ADMIN',
  triggerType: 'user_action',
  metadata: { from: 'MEMBER', to: 'ADMIN' }, // no PII — opaque IDs only
});
```

### `LegalAuditEvent` fields

| Field         | Required | Description                                                   |
| ------------- | :------: | ------------------------------------------------------------- |
| `eventType`   |    ✓     | Dot-notation name, e.g. `org.created`, `gdpr.consent.revoked` |
| `orgId`       |          | Organisation UUID (stored as plain string — no FK)            |
| `actorRole`   |          | RBAC role at time of event                                    |
| `triggerType` |          | `user_action` \| `system` \| `api` \| `scheduler`             |
| `metadata`    |          | Sanitised structured context — no PII or credentials          |

---

## Database

`LegalAuditModule` uses `PrismaLegalService` (from [`@libs/prisma-legal`](../prisma-legal/README.md)), which connects to `LEGAL_AUDIT_DATABASE_URL`. Schema: `prisma/schema.legal.prisma`.

Migrations:

```sh
npx prisma migrate dev --config prisma.config.legal.ts
```

---

## Module setup

```typescript
import { LegalAuditModule } from '@libs/legal-audit';

@Module({ imports: [LegalAuditModule] })
export class OrgsModule {}
```
