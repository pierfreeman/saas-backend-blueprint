# Storage Module

Enterprise-ready file storage system for Multi-tenant SaaS Backend Blueprint with multi-provider support (AWS S3 / Azure Blob), multipart uploads up to 100GB+, and complete quota management.

## Complete Documentation

All documentation organized in `/docs`:

- [docs/21-STORAGE_SETUP.md](../../../docs/21-STORAGE_SETUP.md) - Complete setup and configuration
- [docs/22-STORAGE_QUICK_START.md](../../../docs/22-STORAGE_QUICK_START.md) - Quick start in 5 minutes
- [docs/23-STORAGE_IMPLEMENTATION.md](../../../docs/23-STORAGE_IMPLEMENTATION.md) - Implementation summary
- [docs/24-STORAGE_USAGE_GUIDE.md](../../../docs/24-STORAGE_USAGE_GUIDE.md) - API usage guide

## Quick Start

```bash
# Automatic setup
./docs/setup-storage.sh

# Or manual setup
npm install && \
npx prisma migrate dev --name add_storage_tables && \
npx prisma generate && \
npx ts-node prisma/seeds/storage.seed.ts
```

## Features

- Multi-Provider (S3/Azure)
- Direct Upload (presigned URLs)
- Multipart Upload (100GB+)
- Quota Management
- RBAC Integration
- Audit Logging
- Event Emission
- Automatic Cleanup

## API Endpoints

| Endpoint                                     | Method | Permission    |
| -------------------------------------------- | ------ | ------------- |
| `/storage/upload-session`                    | POST   | `file.upload` |
| `/storage/upload-session/:id/presigned-part` | POST   | `file.upload` |
| `/storage/upload-session/:id/complete`       | POST   | `file.upload` |
| `/storage/upload-session/:id/abort`          | POST   | `file.upload` |
| `/storage/files/:id/download-url`            | GET    | `file.read`   |
| `/storage/files/:id`                         | GET    | `file.read`   |
| `/storage/files`                             | GET    | `file.read`   |
| `/storage/files/:id`                         | DELETE | `file.delete` |
| `/storage/quota`                             | GET    | `file.read`   |

## Structure

```
storage/
├── controllers/          # REST API endpoints
├── facade/              # Main orchestration layer
├── providers/           # S3 & Azure implementations
├── services/            # Business logic services
├── entities/            # Database entities
├── dto/                 # Validation DTOs
├── events/              # Domain events
└── storage.module.ts    # Module definition
```

## Environment Variables

**AWS S3:**

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=sports-intelligence-storage
```

**Azure Blob:**

```bash
AZURE_STORAGE_ACCOUNT=your-account
AZURE_STORAGE_KEY=your-key
AZURE_STORAGE_CONTAINER=sports-intelligence-storage
```

---

**For complete details see:** [docs/21-STORAGE_SETUP.md](../../../docs/21-STORAGE_SETUP.md)

- Old session deletion (daily)
- Provider-level multipart cleanup

## Architecture

```
┌─────────────────┐
│  Controller     │  ← RBAC Guards
│  (REST API)     │
└────────┬────────┘
         │
┌────────▼────────┐
│  StorageFacade  │  ← Orchestration Layer
│                 │
└────────┬────────┘
         │
    ┌────┴────┬─────────┬──────────┬──────────┐
    │         │         │          │          │
┌───▼──┐  ┌──▼───┐  ┌──▼────┐  ┌──▼────┐  ┌─▼────┐
│Upload│  │Multi │  │Presig │  │Quota  │  │File  │
│Sess. │  │part  │  │ned URL│  │       │  │Meta  │
└───┬──┘  └──┬───┘  └──┬────┘  └──┬────┘  └──┬───┘
    │        │         │          │          │
    │     ┌──▼─────────▼──┐       │          │
    │     │  Providers    │       │          │
    │     │  (S3, Azure)  │       │          │
    │     └───────────────┘       │          │
    │                              │          │
    └──────────────┬───────────────┴──────────┘
                   │
            ┌──────▼──────┐
            │  PostgreSQL │
            └─────────────┘
```

## Database Schema

### Files Table

```sql
CREATE TABLE files (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by_user_id UUID NOT NULL,

  storage_provider VARCHAR NOT NULL,  -- S3 | AZURE
  bucket_or_container VARCHAR NOT NULL,
  storage_key VARCHAR NOT NULL,

  file_name VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum VARCHAR NULL,

  entity_type VARCHAR NULL,  -- ORG | TEAM | PLAYER | GENERIC
  entity_id UUID NULL,

  visibility VARCHAR NOT NULL DEFAULT 'PRIVATE',

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP NULL
);
```

### Upload Sessions Table

```sql
CREATE TABLE upload_sessions (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL,

  file_name VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  expected_size BIGINT NOT NULL,

  storage_provider VARCHAR NOT NULL,
  upload_provider_id VARCHAR NULL,  -- Multipart upload ID from provider

  status VARCHAR NOT NULL DEFAULT 'INITIATED',
  -- INITIATED | UPLOADING | COMPLETED | ABORTED | EXPIRED

  expected_parts INTEGER NULL,
  uploaded_parts INTEGER NOT NULL DEFAULT 0,

  metadata JSONB NULL,

  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## API Endpoints

### 1. Create Upload Session

```http
POST /storage/upload-session
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

{
  "fileName": "training-video.mp4",
  "mimeType": "video/mp4",
  "expectedSize": 104857600,
  "storageProvider": "S3",
  "entityType": "TEAM",
  "entityId": "team-uuid"
}

Response 201:
{
  "uploadSessionId": "session-uuid",
  "uploadConfig": {
    "uploadId": "provider-upload-id",
    "storageKey": "org-id/timestamp-uuid.mp4",
    "bucketOrContainer": "sports-intelligence-storage",
    "partSize": 5242880,
    "partCount": 20
  },
  "expiresAt": "2026-02-15T12:00:00Z"
}
```

### 2. Get Presigned URL for Part

```http
POST /storage/upload-session/:sessionId/presigned-part
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

{
  "partNumber": 1
}

Response 200:
{
  "url": "https://s3.amazonaws.com/presigned-url...",
  "partNumber": 1
}
```

### 3. Upload Part (Client-side)

```http
PUT <presigned-url>
Content-Type: video/mp4
Body: <binary-chunk-data>

Response 200:
Headers: ETag: "etag-value"
```

### 4. Complete Upload

```http
POST /storage/upload-session/:sessionId/complete
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

{
  "storageKey": "org-id/timestamp-uuid.mp4",
  "bucketOrContainer": "sports-intelligence-storage",
  "checksum": "md5-checksum",
  "parts": [
    { "partNumber": 1, "eTag": "etag-1" },
    { "partNumber": 2, "eTag": "etag-2" }
  ]
}

Response 200:
{
  "fileId": "file-uuid",
  "fileName": "training-video.mp4",
  "sizeBytes": "104857600",
  "mimeType": "video/mp4",
  "createdAt": "2026-02-14T12:00:00Z"
}
```

### 5. Abort Upload

```http
POST /storage/upload-session/:sessionId/abort
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

{
  "reason": "User cancelled"
}

Response 204: No Content
```

### 6. Get Download URL

```http
GET /storage/files/:fileId/download-url
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

Response 200:
{
  "url": "https://s3.amazonaws.com/presigned-download-url...",
  "expiresIn": 3600
}
```

### 7. List Files

```http
GET /storage/files?limit=100&offset=0&entityType=TEAM&entityId=team-uuid
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

Response 200:
{
  "files": [...],
  "count": 42
}
```

### 8. Delete File

```http
DELETE /storage/files/:fileId
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

Response 204: No Content
```

### 9. Get Quota Usage

```http
GET /storage/quota
Authorization: Bearer <jwt_token>
x-org-id: <org_id>

Response 200:
{
  "plan": "PRO",
  "storageUsedBytes": "10737418240",
  "storageLimitBytes": "53687091200",
  "fileCount": 250,
  "fileCountLimit": 10000,
  "storagePercentage": 20,
  "fileCountPercentage": 2.5
}
```

## Environment Variables

```bash
# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=sports-intelligence-storage
AWS_S3_ENDPOINT=  # Optional, for S3-compatible services

# Azure Blob Configuration
AZURE_STORAGE_ACCOUNT=your-account-name
AZURE_STORAGE_KEY=your-account-key
AZURE_STORAGE_CONTAINER=sports-intelligence-storage
AZURE_STORAGE_ENDPOINT=  # Optional
```

## Setup

### 1. Install Dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install @azure/storage-blob
npm install @nestjs/schedule  # For cleanup jobs
```

### 2. Run Database Migration

```bash
npx prisma migrate dev --name add_storage_tables
npx prisma generate
```

### 3. Seed Permissions

```bash
# Add file storage permissions to database
npm run prisma:seed
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 5. Start Application

```bash
npm run start:dev
```

## Client Upload Flow (Example)

```typescript
// Step 1: Create upload session
const session = await fetch('/storage/upload-session', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'x-org-id': orgId,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    fileName: file.name,
    mimeType: file.type,
    expectedSize: file.size,
    storageProvider: 'S3',
  }),
}).then((r) => r.json());

// Step 2: Upload parts
const { partSize, partCount } = session.uploadConfig;
const parts = [];

for (let i = 1; i <= partCount; i++) {
  const start = (i - 1) * partSize;
  const end = Math.min(start + partSize, file.size);
  const chunk = file.slice(start, end);

  // Get presigned URL
  const { url } = await fetch(`/storage/upload-session/${session.uploadSessionId}/presigned-part`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-org-id': orgId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ partNumber: i }),
  }).then((r) => r.json());

  // Upload chunk directly to S3
  const uploadResponse = await fetch(url, {
    method: 'PUT',
    body: chunk,
  });

  const eTag = uploadResponse.headers.get('ETag');
  parts.push({ partNumber: i, eTag });
}

// Step 3: Complete upload
const result = await fetch(`/storage/upload-session/${session.uploadSessionId}/complete`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'x-org-id': orgId,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    storageKey: session.uploadConfig.storageKey,
    bucketOrContainer: session.uploadConfig.bucketOrContainer,
    parts,
  }),
}).then((r) => r.json());

console.log('File uploaded:', result.fileId);
```

## Testing

```bash
# Unit tests
npm run test:unit -- --testPathPattern=storage

# Integration tests
npm run test:integration -- --testPathPattern=storage

# E2E tests
npm run test:e2e -- storage.e2e-spec.ts

# Coverage
npm run test:cov
```

## Monitoring & Observability

All storage operations emit structured logs and audit events:

```typescript
// Audit events logged automatically
-FILE_UPLOAD_SESSION_CREATED -
  FILE_UPLOADED -
  FILE_UPLOAD_ABORTED -
  FILE_DELETED -
  FILE_DOWNLOAD_URL_GENERATED -
  STORAGE_CLEANUP_EXPIRED_SESSIONS -
  STORAGE_CLEANUP_OLD_SESSIONS;
```

## Cron Jobs

- **Every Hour**: Mark expired upload sessions
- **Daily at 2 AM**: Delete old completed/aborted sessions (7+ days)
- **Every 6 Hours**: Abort expired uploads with provider cleanup

## Security

✅ All uploads require valid JWT authentication
✅ RBAC permissions enforced on all endpoints
✅ Organization context validated
✅ Presigned URLs expire after 1 hour
✅ Upload sessions expire after 24 hours
✅ Soft delete files (can be restored)
✅ Audit log on all operations

## Performance

- **Direct Upload**: File data never touches backend
- **Multipart Support**: Upload 100GB+ files efficiently
- **Concurrent Uploads**: Multiple parts in parallel
- **Optimal Part Size**: Auto-calculated (5MB-100MB)
- **Redis Caching**: (Future) File metadata caching

## Future Enhancements

- [ ] Checksum validation enforcement
- [ ] Upload resume from failed parts
- [ ] Redis caching for file metadata
- [ ] Virus scanning integration
- [ ] Image/video thumbnail generation
- [ ] CDN integration for public files
- [ ] File versioning support
- [ ] Collaboration/sharing permissions

## Support

For issues or questions:

- Check logs: `docker logs sports-intelligence-backend`
- Review audit events: `SELECT * FROM audit_events WHERE type LIKE 'FILE_%'`
- Monitor quota: `GET /storage/quota`
