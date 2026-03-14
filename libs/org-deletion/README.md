# Organization Deletion Library

**GDPR-compliant organization deletion workflow with retention periods and legal audit trail.**

## Overview

This library implements a comprehensive organization deletion system that complies with:
- **GDPR Right to Erasure** (Article 17)
- **ISO 27001** data lifecycle requirements
- **Legal audit requirements** (GDPR Article 5(2) and Article 30)

The deletion workflow supports:
- ✅ Configurable retention periods (default 30 days, customizable per organization)
- ✅ Asynchronous background processing (no blocking HTTP requests)
- ✅ Complete data cleanup (storage, database, Redis cache, Stripe resources)
- ✅ Permanent legal audit trail preservation
- ✅ Idempotent operations (safe for retries)
- ✅ Event-driven architecture
- ✅ Scheduled deletion checker (cron job)
- ✅ User-requested and system-triggered deletions

## Architecture

### Components

1. **OrgDeletionService** - Orchestrates deletion requests and schedules deletion
2. **OrgDeletionWorkerService** - Executes actual data cleanup in background
3. **OrgDeletionSchedulerService** - Cron job that triggers deletion for expired suspended orgs
4. **Event System** - Decouples deletion request from execution

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Deletion Request Flow                         │
└─────────────────────────────────────────────────────────────────┘

1. Owner Request                          2. System Trigger
   POST /organizations/:id/delete            Scheduler checks for
   (OWNER role required)                     suspended + expired orgs
            │                                         │
            └──────────────┬──────────────────────────┘
                           │
                           ▼
                 OrgDeletionService.requestDeletion()
                           │
                ┌──────────┴───────────┐
                │                      │
                ▼                      ▼
        Update Org Status       Calculate Retention
        PENDING_DELETION        scheduledAt = now + retention
                │                      │
                └──────────┬───────────┘
                           │
                           ▼
                Emit OrgDeletionRequestedEvent
                           │
                           ▼
                    Event Bus (SQS)
                           │
                           ▼
                 Worker consumes event
                           │
                           ▼
          OrgDeletionWorkerService.executeDeletion()
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    Delete Storage   Delete DB Data   Clear Redis
    (S3 files)       (cascade)        (cache keys)
          │                │                │
          └────────────────┼────────────────┘
                           │
                           ▼
                   Update Org Status
                       DELETED
                           │
                           ▼
                Record Legal Audit Event
                (permanent, immutable)
```

## Database Schema Changes

### Organization Model Updates

```prisma
enum OrganizationStatus {
  ACTIVE
  SUSPENDED
  PENDING_DELETION  // New
  DELETED          // New
}

model Organization {
  // ... existing fields ...

  status                    OrganizationStatus @default(ACTIVE)
  deletionRequestedAt       DateTime?          @map("deletion_requested_at")
  deletionScheduledAt       DateTime?          @map("deletion_scheduled_at")
  deletionCompletedAt       DateTime?          @map("deletion_completed_at")
  retentionPeriodDays       Int?               @map("retention_period_days")
}
```

### Migration

```bash
# Generate migration
npx prisma migrate dev --name add-org-deletion-fields

# Deploy to production
npx prisma migrate deploy
```

## API Endpoints

### Request Organization Deletion

```http
POST /organizations/:id/delete
Authorization: Bearer {JWT}
x-org-id: {orgId}
```

**Authorization**: Only `OWNER` role can request deletion.

**Response** (202 Accepted):
```json
{
  "message": "Organization deletion requested successfully",
  "scheduledAt": "2026-04-13T14:06:00.000Z"
}
```

**Behavior**:
- Organization status → `PENDING_DELETION`
- Sets `deletionRequestedAt`, `deletionScheduledAt`
- Emits `org.deletion.requested` event
- Returns immediately (deletion is async)

**Error Responses**:
- `400 Bad Request` - Organization already being deleted
- `401 Unauthorized` - Missing/invalid JWT
- `403 Forbidden` - Non-OWNER role
- `404 Not Found` - Organization doesn't exist

## Configuration

### Environment Variables

```bash
# Default retention period in days (GDPR compliance)
ORG_DELETION_RETENTION_DAYS=30

# Cron schedule for checking organizations eligible for deletion
# Default: daily at 3 AM UTC
ORG_DELETION_CHECK_CRON="0 3 * * *"
```

### Custom Retention Period

Set `retentionPeriodDays` on the organization:

```typescript
await prisma.organization.update({
  where: { id: orgId },
  data: { retentionPeriodDays: 60 }, // 60 days for enterprise
});
```

## Event Types

### org.deletion.requested

Emitted when deletion is requested (user or system).

**Payload**:
```typescript
{
  orgId: string;
  trigger: 'USER_REQUEST' | 'SUBSCRIPTION_EXPIRY';
  userId?: string; // undefined for system triggers
  orgName: string;
  requestedAt: Date;
  scheduledAt: Date;
}
```

### org.deletion.started

Emitted when worker begins deletion execution.

**Payload**:
```typescript
{
  orgId: string;
  trigger: 'USER_REQUEST' | 'SUBSCRIPTION_EXPIRY';
  startedAt: Date;
}
```

### org.deletion.completed

Emitted when deletion completes successfully.

**Payload**:
```typescript
{
  orgId: string;
  trigger: 'USER_REQUEST' | 'SUBSCRIPTION_EXPIRY';
  orgName: string;
  requestedAt: Date;
  completedAt: Date;
}
```

### org.deletion.failed

Emitted when deletion fails.

**Payload**:
```typescript
{
  orgId: string;
  trigger: 'USER_REQUEST' | 'SUBSCRIPTION_EXPIRY';
  error: string;
  failedAt: Date;
}
```

## Deletion Steps

When the worker executes deletion, it performs these steps in order:

### 1. Delete Storage Files
Removes all objects under `org/{orgId}/` in S3.

### 2. Delete Business Database Data
Cascading delete of:
- File metadata
- Notifications
- Jobs
- Activity logs
- Memberships

### 3. Clear Redis Cache
Removes all keys matching `tenant:{orgId}:*`.

### 4. Revoke External Resources
If configured:
- Deletes Stripe customer
- Cancels subscriptions

### 5. Mark Organization Deleted
Updates organization:
- `status = DELETED`
- `deletionCompletedAt = now`

### 6. Record Legal Audit Event
Creates permanent, immutable audit record in legal database.

## Scheduled Deletion Checker

The `OrgDeletionSchedulerService` runs daily (default 3 AM) to find suspended organizations past their retention period.

**Query**:
```sql
SELECT * FROM organizations
WHERE status = 'SUSPENDED'
  AND deletionScheduledAt <= NOW()
```

For each eligible org:
1. Triggers `OrgDeletionService.requestDeletion()`
2. Uses `SUBSCRIPTION_EXPIRY` trigger
3. No userId (system-triggered)

## Idempotency

The deletion workflow is safe to retry:

```typescript
// Safe to call multiple times
await deletionWorker.executeDeletion(orgId, trigger, orgName, requestedAt);
```

**Guarantees**:
- Skips if org already `DELETED`
- Missing data doesn't cause errors
- Legal audit events are append-only

## Legal Audit Trail

All deletion events are recorded in the **legal audit database**, which is:
- ✅ Separate from business database
- ✅ Never cleaned or truncated
- ✅ Append-only (immutable)
- ✅ Survives organization deletion

**Example Query**:
```typescript
const events = await legalPrisma.auditEvent.findMany({
  where: { orgId },
  orderBy: { createdAt: 'asc' },
});

// Events include: organization.created, organization.deleted, etc.
```

## Usage Examples

### Request Deletion as Owner

```typescript
// Via API
const response = await fetch('/organizations/abc-123/delete', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ownerToken}`,
    'x-org-id': 'abc-123',
  },
});

const { scheduledAt } = await response.json();
console.log(`Deletion scheduled for: ${scheduledAt}`);
```

### Programmatic Deletion

```typescript
import { OrgDeletionService, DeletionTrigger } from '@libs/org-deletion';

// Inject service
constructor(private deletionService: OrgDeletionService) {}

// Request deletion
await this.deletionService.requestDeletion(
  orgId,
  DeletionTrigger.USER_REQUEST,
  userId,
);
```

### Execute Deletion (Worker)

```typescript
import { OrgDeletionWorkerService } from '@libs/org-deletion';

// Inject worker service
constructor(private deletionWorker: OrgDeletionWorkerService) {}

// Execute deletion
await this.deletionWorker.executeDeletion(
  orgId,
  trigger,
  orgName,
  requestedAt,
);
```

## Testing

### Unit Tests

```bash
# Run all org-deletion unit tests
npx nx test org-deletion

# 15 tests covering:
# - OrgDeletionService (retention calculation, event emission)
# - OrgDeletionSchedulerService (cron job logic)
# - OrgDeletionWorkerService (cleanup operations)
```

### Integration Tests

```bash
# Run integration tests
npx nx e2e api-e2e

# Tests located in:
# apps/api-e2e/src/organizations/org-deletion-retention.integration.spec.ts
```

**Test Coverage**:
- ✅ Owner requesting deletion
- ✅ Status transitions (ACTIVE → PENDING_DELETION → DELETED)
- ✅ Retention period calculation (default + custom)
- ✅ Worker execution and data cleanup
- ✅ Legal audit trail preservation
- ✅ Idempotent deletion (safe retries)
- ✅ RBAC enforcement (only OWNER)

## Error Handling

The deletion workflow handles errors gracefully:

### Worker Failures

If deletion fails:
1. Logs error with full stack trace
2. Emits `org.deletion.failed` event
3. Records failure in legal audit
4. Does NOT throw (allows retry)

### Partial Failures

If some cleanup steps fail:
- Continues with remaining steps
- Logs each failure
- Marks overall deletion as failed
- Can be retried (idempotent)

### Database Constraints

Foreign key constraints are handled:
- Deletion order ensures no constraint violations
- Uses `CASCADE` where appropriate
- Orphaned records are prevented

## Security Considerations

### Authorization
- Only `OWNER` role can request deletion
- Validated at controller and service layers
- JWT authentication required

### Data Sanitization
- All user input is validated
- Organization ID format validated (UUID)
- No SQL injection vulnerabilities

### Audit Compliance
- All deletion actions logged
- Legal audit database immutable
- GDPR Article 30 compliant

## Performance

### Asynchronous Processing
- HTTP request returns immediately (202 Accepted)
- Actual deletion runs in background worker
- No timeout issues

### Batch Operations
- Database deletes use `deleteMany` where possible
- Redis cache cleared in single operation
- S3 deletes use batch API

### Scalability
- Workers can be horizontally scaled
- Event-driven architecture allows distribution
- No blocking operations

## Monitoring

### Metrics to Track

```typescript
// Deletion requests
org.deletion.requested.count
org.deletion.requested.duration

// Worker execution
org.deletion.worker.duration
org.deletion.worker.success.count
org.deletion.worker.failure.count

// Data cleanup
org.deletion.storage.bytes_deleted
org.deletion.database.records_deleted
org.deletion.redis.keys_deleted
```

### Alerts

Set up alerts for:
- ❌ Deletion failures (rate > threshold)
- ❌ Worker execution time > 5 minutes
- ⚠️ Pending deletions > 100 orgs
- ⚠️ Failed deletions not retried

## Compliance

### GDPR Article 17 - Right to Erasure

✅ **User can request deletion**: Via POST endpoint
✅ **Data deleted without undue delay**: 30-day retention period
✅ **Confirmation provided**: HTTP 202 response with scheduled date
✅ **Verification possible**: Legal audit trail

### GDPR Article 5(2) - Accountability

✅ **Demonstrate compliance**: Legal audit database
✅ **Record of processing**: Audit events with timestamps
✅ **Data minimization**: Only necessary data retained during retention period

### GDPR Article 30 - Records of Processing

✅ **Purpose documented**: Deletion for erasure requests or subscription expiry
✅ **Categories of data**: All org-scoped business data
✅ **Time limits**: Configurable retention periods
✅ **Security measures**: Async processing, audit trail, RBAC

### ISO 27001 - Information Security Management

✅ **Data lifecycle**: Full deletion workflow from request to completion
✅ **Access control**: OWNER-only authorization
✅ **Audit trail**: Immutable legal audit database
✅ **Incident handling**: Error logging and retry mechanisms

## Troubleshooting

### Deletion Not Executing

**Symptom**: Organization stays in `PENDING_DELETION`.

**Checks**:
1. Verify worker is running
2. Check event bus configuration
3. Review worker logs
4. Confirm event routing

**Fix**: Manually trigger worker or check event routing.

### Partial Data Deletion

**Symptom**: Some data remains after deletion.

**Checks**:
1. Review worker logs for errors
2. Check database constraints
3. Verify storage permissions
4. Check Redis connectivity

**Fix**: Re-run worker (idempotent) or manually clean remaining data.

## License

This library is part of the SaaS Backend Blueprint project.
