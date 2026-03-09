# @libs/activity-log

Records tenant-visible operational events in the `app_audit.activity_logs` table of the business PostgreSQL database. Every entry is scoped to an organisation and queryable by ADMIN/OWNER roles via the REST API.

---

## Design

- **Fire-and-forget writes** — `logActivity()` never throws. Failures are caught internally and logged via NestJS `Logger`. The business operation that triggered the log is never affected.
- **Org-scoped** — every entry requires a valid `orgId` UUID. Entries with an invalid `orgId` are silently dropped.
- **Cascade-deleted** — logs are removed when the owning organisation is deleted (`onDelete: Cascade` FK).
- **No PII in metadata** — callers must sanitise before passing. IP addresses, user agents, and correlation IDs belong in the legal audit database (see [`@libs/legal-audit`](../legal-audit/README.md)).
- **No dependency on `@libs/legal-audit`** — the two audit systems are fully independent and must never import each other.

---

## Usage

```typescript
import { ActivityLogService } from '@libs/activity-log';

// Fire-and-forget — no await needed
this.activityLogService.logActivity({
  orgId: org.id,
  actorId: user.id,
  actorRole: 'ADMIN',
  action: 'membership.role.changed',
  entityType: 'Membership',
  entityId: membership.id,
  metadata: { from: 'MEMBER', to: 'ADMIN' }, // no PII
});
```

### `ActivityLogEvent` fields

| Field        | Required | Description                                          |
| ------------ | :------: | ---------------------------------------------------- |
| `orgId`      |    ✓     | Organisation UUID — entry is dropped if invalid      |
| `actorId`    |          | User UUID who triggered the action (null for system) |
| `actorRole`  |          | RBAC role at time of action (`OWNER`, `ADMIN`, …)    |
| `action`     |    ✓     | Dot-notation string, e.g. `org.created`              |
| `entityType` |          | Model category, e.g. `Organization`, `Membership`    |
| `entityId`   |          | UUID of the affected entity                          |
| `metadata`   |          | Sanitised structured context — no PII                |

**Action naming convention:** `<domain>.<verb>` or `<domain>.<noun>.<verb>`, e.g. `org.created`, `membership.role.changed`, `billing.subscription.cancelled`.

---

## REST API

| Method | Path                                 | Auth               | Description                       |
| ------ | ------------------------------------ | ------------------ | --------------------------------- |
| `GET`  | `/organizations/:orgId/activity-log` | JWT + `audit.read` | Paginated activity log for an org |

Query params: `limit`, `offset`, `action` (prefix match), `fromDate`, `toDate`.

---

## Module setup

`ActivityLogModule` is not global. Import it in every module that needs it:

```typescript
import { ActivityLogModule } from '@libs/activity-log';

@Module({ imports: [ActivityLogModule] })
export class OrgsModule {}
```

`ActivityLogService` is then injectable in that module's providers.
