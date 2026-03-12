# Storage Module

Production-grade S3 storage abstraction for the SaaS Backend Blueprint.

## Overview

The Storage Module provides a **provider-agnostic file storage system** with presigned upload URLs, multi-tenant isolation, quota enforcement, and comprehensive audit logging.

### Key Features

- **Presigned Upload URLs**: Files upload directly to S3 without routing through the API server
- **Multi-Tenant Isolation**: Storage keys are scoped by organization (`org/{orgId}/{fileId}`)
- **Quota Enforcement**: Per-plan storage limits, file count limits, and max file size restrictions
- **Provider Abstraction**: Ready for S3, Azure Blob, GCS, or S3-compatible providers (MinIO, LocalStack)
- **Audit Logging**: All storage operations are logged to both Activity Log and Legal Audit systems
- **Security**: Tenant isolation enforced at every layer (service, repository, API)

---

## Architecture

### Upload Flow

```
1. Client → API: POST /files/upload-url
   ↓
2. API validates quota and generates presigned S3 URL
   ↓
3. API → Client: Returns { fileId, uploadUrl, expiresAt }
   ↓
4. Client → S3: PUT file to uploadUrl (direct upload, no proxy)
   ↓
5. Client → API: POST /files/confirm { fileId }
   ↓
6. API verifies file exists in S3 and marks as COMPLETED
```

**Why this architecture?**
- Scalability: API server never handles file streams
- Performance: Direct S3 uploads leverage AWS edge network
- Cost: No egress costs for API server
- Supports very large files (tens of GB) without API timeouts

### Download Flow

```
1. Client → API: GET /files/:id/download
   ↓
2. API generates presigned S3 download URL
   ↓
3. API → Client: Returns { downloadUrl, expiresAt, filename }
   ↓
4. Client → S3: GET from downloadUrl (direct download)
```

---

## Storage Key Strategy

All files are stored with tenant-scoped keys:

```
org/{orgId}/{fileId}
```

**Example:**
```
org/abc-123-def-456/file-789-xyz
```

This ensures:
- **Tenant isolation**: Files cannot be accessed across organizations
- **Predictable structure**: Easy to audit and debug
- **Cleanup**: When an org is deleted, all files cascade-delete via foreign key

---

## Database Model

The `File` table stores metadata only (never actual file bytes):

```prisma
model File {
  id          String     @id @default(uuid())
  orgId       String
  uploadedBy  String
  storageKey  String     @unique
  provider    String     // S3, AZURE, etc.
  filename    String
  size        BigInt?
  mimeType    String?
  status      FileStatus @default(PENDING)
  expiresAt   DateTime?
  confirmedAt DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  organization Organization @relation(...)

  @@index([orgId, createdAt(sort: Desc)])
  @@index([orgId, status])
  @@index([uploadedBy, createdAt(sort: Desc)])
  @@index([status, expiresAt])
}

enum FileStatus {
  PENDING    // Upload URL generated, awaiting upload
  COMPLETED  // Upload confirmed, file available
  EXPIRED    // Upload session expired
  ABORTED    // Upload explicitly aborted by user
}
```

---

## API Endpoints

### POST /files/upload-url

Generate a presigned upload URL.

**Request:**
```json
{
  "filename": "document.pdf",
  "mimeType": "application/pdf",
  "size": 1048576
}
```

**Response:**
```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadUrl": "https://s3.amazonaws.com/bucket/org/org-id/file-id?X-Amz-Signature=...",
  "storageKey": "org/org-id/file-id",
  "expiresAt": "2026-03-12T13:00:00.000Z"
}
```

**Validations:**
- File size within plan limits
- Storage quota not exceeded
- File count limit not reached
- User has MEMBER role or higher

---

### POST /files/confirm

Confirm that a file has been uploaded.

**Request:**
```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**
```json
{
  "fileId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "COMPLETED",
  "confirmedAt": "2026-03-12T12:30:00.000Z"
}
```

**Validations:**
- File exists in database
- File belongs to user's organization
- File status is PENDING
- Upload session not expired
- File exists in S3

---

### GET /files/:id/download

Generate a presigned download URL.

**Response:**
```json
{
  "downloadUrl": "https://s3.amazonaws.com/bucket/org/org-id/file-id?X-Amz-Signature=...",
  "expiresAt": "2026-03-12T13:00:00.000Z",
  "filename": "document.pdf",
  "mimeType": "application/pdf",
  "size": "1048576"
}
```

**Validations:**
- File exists and belongs to user's organization
- File status is COMPLETED
- User has READ_ONLY role or higher

---

### GET /files/:id

Get file metadata.

**Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "orgId": "123e4567-e89b-12d3-a456-426614174000",
  "uploadedBy": "456e7890-e89b-12d3-a456-426614174111",
  "storageKey": "org/org-id/file-id",
  "provider": "S3",
  "filename": "document.pdf",
  "size": "1048576",
  "mimeType": "application/pdf",
  "status": "COMPLETED",
  "expiresAt": null,
  "confirmedAt": "2026-03-12T12:30:00.000Z",
  "createdAt": "2026-03-12T12:00:00.000Z",
  "updatedAt": "2026-03-12T12:30:00.000Z"
}
```

---

### GET /files

List files for the organization.

**Query Parameters:**
- `limit` (optional): Max results (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "document.pdf",
    "size": "1048576",
    ...
  }
]
```

---

### DELETE /files/:id

Delete a file.

**Response:** `204 No Content`

**Validations:**
- File exists and belongs to user's organization
- User has MEMBER role or higher

**Side Effects:**
- File deleted from S3
- Metadata deleted from database
- Activity logged
- Legal audit event recorded

---

## Storage Quotas

Quotas are configured per plan type via environment variables:

### Free Plan
```env
FREE_PLAN_STORAGE_LIMIT_GB=1
FREE_PLAN_FILE_COUNT_LIMIT=100
FREE_PLAN_MAX_FILE_SIZE_GB=0.1  # 100MB
```

### Pro Plan
```env
PRO_PLAN_STORAGE_LIMIT_GB=50
PRO_PLAN_FILE_COUNT_LIMIT=10000
PRO_PLAN_MAX_FILE_SIZE_GB=20
```

### Enterprise Plan
```env
# Leave empty for unlimited
ENTERPRISE_PLAN_STORAGE_LIMIT_GB=
ENTERPRISE_PLAN_FILE_COUNT_LIMIT=
ENTERPRISE_PLAN_MAX_FILE_SIZE_GB=100
```

Organizations can also have custom `storageLimit` values in the database, which override plan defaults.

---

## Security Considerations

### Tenant Isolation

Every operation validates `orgId`:
```typescript
// Service layer
const file = await this.storageRepository.findByIdAndOrg(fileId, orgId);
if (!file) {
  throw new NotFoundException();
}

// Repository layer
await this.prisma.file.findFirst({
  where: { id: fileId, orgId: orgId }
});
```

### RBAC Enforcement

API endpoints use guards:
```typescript
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@RequireRole(MembershipRole.MEMBER)
```

### Presigned URL Expiration

Upload and download URLs expire after 1 hour (configurable):
```env
PRESIGNED_URL_EXPIRATION_SECONDS=3600
```

### No File Streaming Through API

Files never pass through the API server. This prevents:
- DoS attacks via large file uploads
- Server resource exhaustion
- API timeouts on slow connections

---

## Audit Logging

Every storage operation generates **two audit events**:

### Activity Log (Business-Level)
Visible to organization admins:
```typescript
this.activityLog.logActivity({
  orgId,
  actorId: userId,
  action: 'file.upload.confirmed',
  entityType: 'File',
  entityId: fileId,
  metadata: { filename },
});
```

### Legal Audit (Compliance)
Append-only, immutable:
```typescript
this.legalAudit.recordEvent({
  eventType: 'file.upload.confirmed',
  orgId,
  triggerType: 'user_action',
  metadata: { fileId, filename },
});
```

---

## Environment Variables

### AWS S3 Configuration
```env
DEFAULT_STORAGE_PROVIDER=S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
# Optional: For S3-compatible services
AWS_S3_ENDPOINT=http://localhost:4566
```

### Upload Session
```env
UPLOAD_SESSION_EXPIRATION_HOURS=24
UPLOAD_SESSION_RETENTION_DAYS=7
PRESIGNED_URL_EXPIRATION_SECONDS=3600
```

### Cleanup Jobs
```env
STORAGE_CLEANUP_ENABLED=true
# Cron schedules (optional)
STORAGE_CLEANUP_EXPIRED_SESSIONS_CRON=0 * * * *
STORAGE_CLEANUP_OLD_SESSIONS_CRON=0 2 * * *
STORAGE_CLEANUP_EXPIRED_UPLOADS_CRON=0 */6 * * *
```

---

## Local Development

### Using LocalStack

LocalStack provides S3-compatible storage for local development.

#### 1. Start Services
```bash
docker compose up -d
```

This starts:
- PostgreSQL (business DB)
- PostgreSQL (legal audit DB)
- Redis
- LocalStack (S3 + SQS)

#### 2. Verify S3 Bucket
```bash
docker compose exec localstack awslocal s3 ls
# Should show: saas-backend-storage
```

#### 3. Configure Environment
```env
AWS_S3_ENDPOINT=http://localhost:4566
AWS_S3_BUCKET=saas-backend-storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

#### 4. Run Migrations
```bash
npm run prisma:migrate:dev
```

#### 5. Start API
```bash
npm run start:api
```

---

## Testing

### Unit Tests

Run all storage unit tests:
```bash
nx test storage
```

Run specific test file:
```bash
nx test storage --testFile=s3.provider.spec.ts
```

### Integration Tests

Integration tests use LocalStack and require docker-compose:

```bash
# Start test infrastructure
npm run test:infra:up

# Run migrations
npm run test:migrate

# Run integration tests
nx run storage:e2e

# Cleanup
npm run test:infra:down
```

**Test scenarios covered:**
- Presigned upload URL generation
- File upload confirmation
- Download URL generation
- Tenant isolation (user from org A cannot access file from org B)
- Quota enforcement
- File deletion

---

## Future Enhancements

### Azure Blob Storage Support

Implement `AzureProvider`:
```typescript
export class AzureProvider implements IStorageProvider {
  async generateUploadUrl(key: string, contentType: string, expiresIn: number): Promise<string> {
    // Use @azure/storage-blob
  }
}
```

Register in `StorageService`:
```typescript
private getProvider(providerType: StorageProvider): IStorageProvider {
  switch (providerType) {
    case StorageProvider.S3:
      return this.s3Provider;
    case StorageProvider.AZURE:
      return this.azureProvider; // NEW
  }
}
```

### Cleanup Jobs

Implement scheduled jobs to:
- Mark expired pending uploads as `EXPIRED`
- Delete old upload sessions
- Remove orphaned files from S3

### Multipart Upload Support

For very large files (>5GB), implement multipart uploads:
- Generate initiate multipart upload URL
- Client uploads parts
- Client completes multipart upload
- Confirm completion

### File Thumbnails/Previews

Generate thumbnails for images:
- On upload confirmation, enqueue thumbnail generation job
- Worker processes image and stores thumbnail
- API serves thumbnail via presigned URL

---

## Troubleshooting

### Presigned URLs Not Working

**Symptom:** Upload fails with 403 Forbidden

**Solutions:**
1. Check AWS credentials are correct
2. Verify bucket exists and is in correct region
3. Check bucket CORS configuration allows PUT from your domain
4. For LocalStack, ensure `forcePathStyle: true` is set

### Files Not Confirming

**Symptom:** File uploaded but confirm fails with "File not uploaded to storage"

**Solutions:**
1. Ensure client uploads to exact URL returned (no modifications)
2. Check client uses PUT request, not POST
3. Verify `Content-Type` header matches `mimeType` from upload URL request
4. Check LocalStack logs: `docker compose logs localstack`

### Quota Errors

**Symptom:** Upload fails with "Storage quota exceeded"

**Solutions:**
1. Check organization's current storage usage
2. Verify plan limits in environment variables
3. Check for custom `storageLimit` on Organization model
4. Use `GET /files` to audit file count

---

## Integration Guide

### Using Storage in Other Modules

```typescript
import { StorageService } from '@libs/storage';

@Injectable()
export class DocumentService {
  constructor(private readonly storageService: StorageService) {}

  async createDocument(orgId: string, userId: string, file: Express.Multer.File) {
    // Generate upload URL
    const upload = await this.storageService.generateUploadUrl({
      orgId,
      userId,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    // Return upload URL to client
    return upload;
  }

  async getDocumentUrl(fileId: string, orgId: string, userId: string) {
    // Generate download URL
    const download = await this.storageService.generateDownloadUrl({
      fileId,
      orgId,
      userId,
    });

    return download.downloadUrl;
  }
}
```

### Checking Storage Quota

```typescript
import { UploadPolicyService } from '@libs/storage';

async checkQuota(orgId: string) {
  const quota = await this.uploadPolicyService.getStorageQuota(
    orgId,
    'pro',
    organization.storageLimit,
  );

  console.log(`Used: ${quota.storageUsedBytes}`);
  console.log(`Limit: ${quota.storageLimitBytes}`);
  console.log(`Files: ${quota.fileCount} / ${quota.fileCountLimit}`);
}
```

---

## License

MIT
