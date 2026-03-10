# Data Exports Module

GDPR/ISO27001 compliance feature that allows organization owners and admins to request a complete export of their organization's data.

## Overview

The Data Exports module provides endpoints for organization data exports in compliance with GDPR Article 15 (Right of Access) and ISO27001 requirements. Only users with OWNER or ADMIN roles can request exports.

## Features

- **Async Export Processing**: Export jobs are processed asynchronously via SQS to handle large datasets without blocking the API
- **Multi-tenant Isolation**: Strict tenant isolation ensures users can only export data from organizations they belong to
- **Multiple Formats**: Supports JSON and CSV export formats (CSV implementation pending)
- **Comprehensive Data**: Exports include organization details, memberships, activity logs, and billing history
- **Activity Logging**: All export requests and completions are logged for audit trails
- **Real-time Updates**: WebSocket notifications for export job status updates (via Redis pub/sub)

## API Endpoints

### POST `/organizations/:orgId/data-exports`

Request a new data export for an organization.

**Authorization**: Requires `ORG_DATA_EXPORT` permission (OWNER or ADMIN only)

**Request Body**:
```json
{
  "format": "json"  // Optional: "json" (default) or "csv"
}
```

**Response** (202 ACCEPTED):
```json
{
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "PENDING",
  "message": "Export job submitted for processing"
}
```

### GET `/organizations/:orgId/data-exports/:jobId`

Get the status of a data export job.

**Authorization**: Requires `ORG_DATA_EXPORT` permission (OWNER or ADMIN only)

**Response** (200 OK):
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "DONE",
  "downloadUrl": "https://s3.amazonaws.com/...",  // When status is DONE
  "createdAt": "2026-03-10T10:00:00.000Z",
  "finishedAt": "2026-03-10T10:05:00.000Z"
}
```

**Job Statuses**:
- `PENDING`: Job has been queued and is waiting for a worker
- `PROCESSING`: Worker is actively generating the export
- `DONE`: Export completed successfully (downloadUrl available)
- `FAILED`: Export failed (error message available)

## Architecture

### Flow Diagram

```
┌─────────┐     POST /data-exports      ┌──────────┐
│ Client  │──────────────────────────────>│   API    │
└─────────┘                              └──────────┘
                                              │
                                              │ 1. Create Job (PENDING)
                                              │ 2. Publish to SQS
                                              ▼
                                         ┌──────────┐
                                         │ Postgres │
                                         └──────────┘
                                              │
                                              │ 3. SQS Event
                                              ▼
                                         ┌──────────┐
                                         │ Worker-A │
                                         └──────────┘
                                              │
                                              │ 4. Process Export
                                              │ 5. Update Job (DONE)
                                              │ 6. Publish Redis
                                              ▼
┌─────────┐     WebSocket notification  ┌──────────┐
│ Client  │<─────────────────────────────│  Redis   │
└─────────┘                              └──────────┘
```

### Components

1. **DataExportsController** (`data-exports.controller.ts`)
   - HTTP endpoints for export request and status polling
   - RBAC enforcement via `@RequirePermissions([PERMISSIONS.ORG_DATA_EXPORT])`
   - Tenant isolation via `@OrgScoped()` and `OrgContextGuard`

2. **DataExportsService** (`data-exports.service.ts`)
   - Business logic for creating export jobs
   - Publishes `DATA_EXPORT_REQUESTED` events to SQS
   - Queries job status with tenant isolation

3. **WorkerController** (`apps/worker-a/src/worker.controller.ts`)
   - Handles `DATA_EXPORT_REQUESTED` events from SQS
   - Generates comprehensive org data export
   - Updates job status and publishes real-time updates via Redis

4. **SqsConsumerService** (`apps/worker-a/src/sqs-consumer.service.ts`)
   - Long-polls SQS Standard queue
   - Dispatches events to appropriate handlers

## Data Included in Exports

Each export contains:

1. **Organization Details**:
   - ID, name, status, billing status
   - Plan details, seat count
   - Created/updated timestamps

2. **Memberships**:
   - All org members with roles and statuses
   - User email addresses
   - Membership timestamps

3. **Activity Logs**:
   - Recent 1000 activity log entries
   - Actions, actors, timestamps
   - Metadata for each event

4. **Billing History**:
   - Subscription snapshots
   - Plan changes, seat changes
   - Billing period timestamps

## Security & Compliance

### RBAC
- Only OWNER and ADMIN roles can request exports
- Permission check: `PERMISSIONS.ORG_DATA_EXPORT`
- Enforced via `RBACGuard` and `@RequirePermissions` decorator

### Multi-tenant Isolation
- All queries scoped by `orgId`
- `OrgContextGuard` validates membership before processing
- Job status queries enforce tenant boundaries

### Audit Trail
- All export requests logged to `activity_logs` table
- Export completions/failures also logged
- Includes actor, timestamp, and metadata

### Data Privacy
- Exports are scoped to single organization
- No cross-tenant data leakage possible
- Sensitive billing data (Stripe IDs) excluded from exports

## Future Enhancements

### Short-term
- [ ] Implement CSV export format (currently returns JSON structure)
- [ ] Upload exports to S3 with pre-signed download URLs
- [ ] Set expiration on S3 URLs (e.g., 24 hours)
- [ ] Add pagination for large activity log exports

### Long-term
- [ ] Selective data exports (e.g., only memberships or only activity logs)
- [ ] Scheduled/recurring exports
- [ ] Email notification when export is ready
- [ ] Export compression (gzip)
- [ ] Legal audit DB integration (compliance logging)

## Testing

### Unit Tests
Run unit tests for the service:
```bash
npm run test:unit -- apps/api/src/app/data-exports
```

### Integration Tests
Integration tests are included in the `api-e2e` test suite. Run with:
```bash
npm run test:integration:api
```

## Configuration

No additional configuration required. The module uses:
- Standard SQS queue (via `EVENT_BUS_TRANSPORT` and `SQS_STANDARD_QUEUE_URL`)
- Existing Prisma business database connection
- Existing Redis connection for pub/sub

## Development

### Local Testing

1. Start test infrastructure:
```bash
npm run test:infra:up
```

2. Start the API:
```bash
npm run start:api
```

3. Start the worker (in a separate terminal):
```bash
npm run build:worker-a
npm run start:worker-a
```

4. Make a test request (requires auth token):
```bash
curl -X POST http://localhost:3000/organizations/{orgId}/data-exports \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"format": "json"}'
```

5. Poll for status:
```bash
curl http://localhost:3000/organizations/{orgId}/data-exports/{jobId} \
  -H "Authorization: Bearer {token}"
```

## Related Modules

- **Activity Log Module** (`libs/activity-log`): Logs all export requests
- **Events Module** (`libs/events`): SQS event publishing
- **RBAC Module** (`apps/api/src/app/rbac`): Permission enforcement
- **Tasks Module** (`apps/api/src/app/tasks`): Similar async job pattern

## Compliance References

- **GDPR Article 15**: Right of access - data subjects have the right to obtain a copy of their personal data
- **ISO27001 A.8.15**: Logging and monitoring - audit trails for data access requests
- **ISO27001 A.18.1.4**: Privacy and protection of personal data - mechanisms to comply with data subject rights
