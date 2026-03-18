# Organization Data Export Library

GDPR-compliant, asynchronous organization data export with async job processing.

---

## Overview

The **org-export** library provides a complete solution for exporting organization data in compliance with GDPR Right to Data Portability and ISO 27001 requirements. It implements an async job-based architecture that:

- Creates export requests via REST API
- Processes exports asynchronously via background workers
- Generates compressed JSON files with all organization data
- Provides secure, time-limited download URLs
- Automatically handles export expiration
- Maintains a complete audit trail

---

## Architecture

```
┌─────────────────┐
│  API Request    │
│  POST /org/     │
│    :id/export   │
└────────┬────────┘
         │
         ▼
  ┌──────────────┐      ┌─────────────┐
  │  OrgExport   │◄────►│     Job     │
  │   (state)    │      │ (execution) │
  └──────┬───────┘      └──────┬──────┘
         │                     │
         │                     ▼
         │            ┌──────────────────┐
         │            │ SQS Standard     │
         │            │ org.export.      │
         │            │   requested      │
         │            └────────┬─────────┘
         │                     │
         ▼                     ▼
  ┌─────────────────────────────────────┐
  │   OrgExportWorkerService            │
  │   • Aggregate data                  │
  │   • Generate JSON + gzip            │
  │   • Upload to storage               │
  │   • Generate signed URL             │
  │   • Update OrgExport + Job          │
  │   • Emit events + audit logs        │
  └─────────────────────────────────────┘
         │
         ▼
  ┌──────────────┐
  │   Storage    │
  │ exports/org/ │
  │  {orgId}/    │
  │ {exportId}.  │
  │  json.gz     │
  └──────────────┘
```

---

## Components

### 1. OrgExportService

Orchestrates export requests from the API layer.

**Key Methods:**
- `requestExport(orgId, userId)` — Create export + job, emit event
- `getExport(exportId, orgId)` — Retrieve export status
- `listExports(orgId, limit, offset)` — List all exports for org

---

### 2. OrgExportWorkerService

Executes the actual data export in the background worker.

**Workflow:**
1. Load & Validate
2. Update Status (PROCESSING)
3. Aggregate Data
4. Generate File (JSON + gzip)
5. Upload to Storage
6. Generate Download URL
7. Mark Complete
8. Emit Events

---

### 3. OrgExportSchedulerService

Manages export lifecycle with scheduled tasks (daily at 3 AM).

---

## API Endpoints

### Request Export
`POST /organizations/:id/export` (OWNER/ADMIN only)

### Get Export Status
`GET /organizations/:id/exports/:exportId`

### List Exports
`GET /organizations/:id/exports`

---

## Security

- Role-based access control (OWNER/ADMIN only)
- Tenant isolation (all queries scoped to orgId)
- Signed download URLs (24h expiration)
- Legal audit logging (immutable compliance records)

---

## Configuration

| Variable                       | Default | Description                        |
|--------------------------------|---------|------------------------------------|
| `EXPORT_URL_EXPIRATION_HOURS`  | 24      | Signed URL lifetime                |

---

## Future Enhancements

- [ ] Implement actual storage upload
- [ ] Implement signed URL generation from storage provider
- [ ] Support multiple export formats (CSV, XML)
- [ ] Add export file encryption
- [ ] Support incremental exports
- [ ] Add webhook notifications on completion
