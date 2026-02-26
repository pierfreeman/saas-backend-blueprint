# @libs/audit

Compliance-grade, append-only audit trail library.

Satisfies:

- **ISO 27001:2022** A.8.15 (Logging) and A.8.16 (Monitoring)
- **GDPR** Art. 5(2) – Accountability, Art. 30 – Records of Processing, Art. 32 – Security of Processing

---

## Key design decisions

- Writes are **fire-and-forget** — audit failures are logged but never propagated, so a DB write error cannot abort a business transaction.
- Sensitive field names (`password`, `token`, `apiKey`, `creditCard`, etc.) are **automatically redacted** from payloads before persistence.
- Records are **never updated or deleted** through the application. The `audit_events` table is append-only.
- Severity falls back to a **default severity map** per event type (see `audit-event-types.constants.ts`) when not explicitly provided.

---

## Usage

### 1. Import `AuditModule`

`AuditModule` depends on `PrismaModule` (which is global). Import it in any module that needs audit logging:

```typescript
import { AuditModule } from '@libs/audit';

@Module({
  imports: [AuditModule],
})
export class OrganizationsModule {}
```

### 2. Log an event

```typescript
import { AuditService, AUDIT_EVENTS } from '@libs/audit';

@Injectable()
export class OrganizationsService {
  constructor(private readonly audit: AuditService) {}

  async deleteOrganization(id: string, userId: string) {
    await this.audit.logEvent({
      type: AUDIT_EVENTS.ORGANIZATION.DELETED, // 'org.deleted'
      severity: 'HIGH',
      orgId: id,
      userId,
      payload: { organizationId: id },
      // ipAddress and userAgent can be extracted from the request
    });
  }
}
```

### 3. Query audit events (paginated)

```typescript
const result = await this.audit.findByOrg(orgId, {
  limit: 50,
  offset: 0,
  typePrefix: 'auth.', // filter by event type prefix
  severity: 'HIGH', // filter by severity
  fromDate: new Date('2026-01-01'),
  toDate: new Date('2026-12-31'),
});

// result: { events, total, limit, offset }
```

---

## `AuditLogOptions`

| Field           | Type                      | Required | Description                                         |
| --------------- | ------------------------- | :------: | --------------------------------------------------- |
| `type`          | `string`                  |    ✓     | Event type (use `AUDIT_EVENTS` constants)           |
| `orgId`         | `string \| null`          |          | Organization scope; null = global/system event      |
| `userId`        | `string \| null`          |          | User who triggered the action; null = system        |
| `payload`       | `Record<string, unknown>` |          | Structured context (sensitive fields auto-redacted) |
| `severity`      | `AuditSeverityLevel`      |          | Overrides the default severity for this event type  |
| `ipAddress`     | `string \| null`          |          | Source IP (GDPR access log)                         |
| `userAgent`     | `string \| null`          |          | User-Agent header                                   |
| `correlationId` | `string \| null`          |          | Distributed tracing ID                              |

---

## Event type constants

All event types are in `libs/audit/src/lib/audit-event-types.constants.ts`, grouped by domain:

| Namespace                   | Example constants                                                |
| --------------------------- | ---------------------------------------------------------------- |
| `AUDIT_EVENTS.AUTH`         | `LOGIN_SUCCESS`, `LOGIN_FAILED`, `MFA_ENABLED`                   |
| `AUDIT_EVENTS.USER`         | `CREATED`, `UPDATED`, `DELETED`, `EMAIL_CHANGED`                 |
| `AUDIT_EVENTS.ORGANIZATION` | `CREATED`, `UPDATED`, `DELETED`, `SUSPENDED`                     |
| `AUDIT_EVENTS.MEMBERSHIP`   | `CREATED`, `ROLE_CHANGED`, `DELETED`                             |
| `AUDIT_EVENTS.GDPR`         | `DATA_EXPORT_REQUESTED`, `DELETION_COMPLETED`, `CONSENT_GRANTED` |
| `AUDIT_EVENTS.SECURITY`     | `ACCESS_DENIED`, `BRUTE_FORCE_DETECTED`, `RATE_LIMIT_EXCEEDED`   |
| `AUDIT_EVENTS.BILLING`      | `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`                   |

### Adding a new event type

1. Add the constant string to the appropriate namespace in `audit-event-types.constants.ts`.
2. Optionally add a default severity to `DEFAULT_SEVERITY_MAP` in the same file.
3. Use `AUDIT_EVENTS.YOUR_DOMAIN.YOUR_EVENT` in calling code.

---

## Nx tasks

```sh
npx nx build audit    # compile
npx nx test audit     # unit tests
npx nx lint audit     # lint
```
