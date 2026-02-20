# 🎯 Storage Module - Quick Start (5 minutes)

Quick guide to test the storage module in 5 minutes.

---

## 📦 Automated Setup (One Command)

```bash
cd /home/pserena/workspace/sports-intelligence-backend
npm install && \
npx prisma migrate dev --name add_storage_tables && \
npx prisma generate && \
npx ts-node prisma/seeds/storage.seed.ts
```

**Or use the automated script:**

```bash
./docs/setup-storage.sh
```

---

## 🔑 Environment Variables (Minimum Required)

Add to your `.env`:

### Option 1: AWS S3

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-here
AWS_SECRET_ACCESS_KEY=your-secret-key-here
AWS_S3_BUCKET=sports-intelligence-storage
```

### Option 2: Azure Blob (alternative)

```bash
AZURE_STORAGE_ACCOUNT=your-account-name
AZURE_STORAGE_KEY=your-account-key-here
AZURE_STORAGE_CONTAINER=sports-intelligence-storage
```

---

## 🚀 Test API (Verify Functionality)

### 1. Start Backend

```bash
npm run start:dev
```

Verify logs:
```
✅ S3 Storage Provider registered
✅ Azure Blob Storage Provider registered
Storage Cleanup Service initialized
```

### 2. Get JWT Token

```bash
# Use Auth0 or generate test token
export JWT_TOKEN="your-jwt-token"
export ORG_ID="your-org-id"
```

### 3. Create Upload Session

```bash
curl -X POST http://localhost:3000/storage/upload-session \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test-video.mp4",
    "mimeType": "video/mp4",
    "expectedSize": 10485760,
    "storageProvider": "S3",
    "entityType": "TEAM",
    "entityId": "team-uuid-123"
  }'
```

**Expected response (201):**
```json
{
  "uploadSessionId": "session-uuid",
  "uploadConfig": {
    "uploadId": "multipart-upload-id",
    "storageKey": "org-id/2026-02-14-uuid.mp4",
    "bucketOrContainer": "sports-intelligence-storage",
    "partSize": 5242880,
    "partCount": 2
  },
  "expiresAt": "2026-02-15T12:00:00Z"
}
```

### 4. Get Presigned URL for Part

```bash
export SESSION_ID="session-uuid"  # from previous response

curl -X POST http://localhost:3000/storage/upload-session/${SESSION_ID}/presigned-part \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{"partNumber": 1}'
```

**Response atteso (200):**
```json
{
  "url": "https://s3.amazonaws.com/sports-intelligence-storage/org-id/file.mp4?X-Amz-Algorithm=...",
  "partNumber": 1
}
```

### 5. Upload Part (Direct to S3/Azure)

```bash
export PRESIGNED_URL="url-from-previous-response"

# Upload binary chunk
curl -X PUT "${PRESIGNED_URL}" \
  -H "Content-Type: video/mp4" \
  --data-binary @test-chunk.bin
```

**Expected response (200):** Header `ETag: "etag-value"`

### 6. Complete Upload

```bash
curl -X POST http://localhost:3000/storage/upload-session/${SESSION_ID}/complete \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "storageKey": "org-id/2026-02-14-uuid.mp4",
    "bucketOrContainer": "sports-intelligence-storage",
    "parts": [
      {"partNumber": 1, "eTag": "etag-value-1"}
    ]
  }'
```

**Response atteso (200):**
```json
{
  "fileId": "file-uuid",
  "fileName": "test-video.mp4",
  "sizeBytes": "10485760",
  "mimeType": "video/mp4",
  "createdAt": "2026-02-14T12:00:00Z"
}
```

### 7. Get Download URL

```bash
export FILE_ID="file-uuid"  # from previous response

curl http://localhost:3000/storage/files/${FILE_ID}/download-url \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}"
```

**Response atteso (200):**
```json
{
  "url": "https://s3.amazonaws.com/presigned-download-url...",
  "expiresIn": 3600
}
```

### 8. Check Quota Usage

```bash
curl http://localhost:3000/storage/quota \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}"
```

**Response atteso (200):**
```json
{
  "plan": "PRO",
  "storageUsedBytes": "10485760",
  "storageLimitBytes": "53687091200",
  "fileCount": 1,
  "fileCountLimit": 10000,
  "storagePercentage": 0.02,
  "fileCountPercentage": 0.01
}
```

---

## 🔐 RBAC Permissions Quick Reference

| Permission | Description | Endpoints |
|------------|-------------|-----------|
| `file.upload` | Upload files | `POST /upload-session`, `POST /presigned-part`, `POST /complete` |
| `file.read` | View/download | `GET /files`, `GET /files/:id`, `GET /download-url` |
| `file.delete` | Delete files | `DELETE /files/:id` |
| `file.manage` | Full management | All |

### Default Role Assignments

- **Owner**: `file.manage` (all permissions)
- **Admin**: `file.manage` (all permissions)
- **Member**: `file.upload`, `file.read`
- **Coach**: `file.upload`, `file.read`, `file.delete`

---

## 📊 Database Tables Quick View

### files

```sql
SELECT 
  file_name, 
  size_bytes, 
  storage_provider, 
  entity_type,
  created_at
FROM files 
WHERE org_id = 'your-org-id' 
  AND deleted_at IS NULL
ORDER BY created_at DESC 
LIMIT 10;
```

### upload_sessions

```sql
SELECT 
  status, 
  file_name, 
  expected_size,
  uploaded_parts,
  expected_parts,
  expires_at,
  created_at
FROM upload_sessions 
WHERE org_id = 'your-org-id'
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🔄 Cron Jobs (Automatic Cleanup)

| Job | Schedule | Action |
|-----|----------|--------|
| Mark Expired | Every hour | Mark expired sessions (>24h) as EXPIRED |
| Delete Old | Daily at 2 AM | Delete sessions >7 days old |
| Abort Expired | Every 6 hours | Cleanup expired multipart uploads on provider |

Verify execution:
```sql
SELECT * FROM audit_events 
WHERE type IN ('STORAGE_CLEANUP_EXPIRED_SESSIONS', 'STORAGE_CLEANUP_OLD_SESSIONS')
ORDER BY created_at DESC 
LIMIT 10;
```

---

## 🧪 Run Tests

### Unit Tests

```bash
# Test storage facade
npm run test:unit -- storage-facade.spec

# Test quota service
npm run test:unit -- storage-quota.service.spec

# All storage unit tests
npm run test:unit -- --testPathPattern=storage
```

### E2E Tests

```bash
# Storage E2E tests
npm run test:e2e -- storage.e2e-spec.ts
```

### Coverage

```bash
npm run test:cov
```

---

## 🚨 Troubleshooting Common Issues

| Error | Cause | Solution |
|-------|-------|----------|
| "Storage provider not configured" | Missing env vars | Verify `AWS_ACCESS_KEY_ID` or `AZURE_STORAGE_ACCOUNT` |
| "Quota exceeded" | Storage limit reached | Check `GET /storage/quota`, upgrade plan or delete files |
| "Upload session expired" | Session >24h | Create new session |
| "CORS error" | CORS not configured | Configure CORS on S3/Azure bucket |
| TypeScript errors | Prisma client not generated | Run `npx prisma generate` |
| "Permission denied" | Role without permission | Verify role assignment in database |
| Presigned URL expired | URL >1h | Generate new presigned URL |

### Debug Commands

```bash
# Check environment vars
env | grep AWS
env | grep AZURE

# Check Prisma schema
npx prisma db pull

# Check provider registration in logs
npm run start:dev | grep "Storage Provider"

# Check audit log
psql -d your-db -c "SELECT * FROM audit_events WHERE type LIKE 'FILE_%' ORDER BY created_at DESC LIMIT 10;"

# Check quota usage
curl http://localhost:3000/storage/quota \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -H "x-org-id: ${ORG_ID}"
```

---

## 📁 Key Files Reference

| File | Path | Purpose |
|------|------|---------|
| Module | `src/modules/storage/storage.module.ts` | Module definition |
| Facade | `src/modules/storage/facade/storage.facade.ts` | Main orchestration |
| Controller | `src/modules/storage/controllers/storage.controller.ts` | REST API endpoints |
| S3 Provider | `src/modules/storage/providers/s3.provider.ts` | AWS S3 implementation |
| Azure Provider | `src/modules/storage/providers/azure.provider.ts` | Azure Blob implementation |
| Schema | `prisma/schema.prisma` | Database schema |
| Seed | `prisma/seeds/storage.seed.ts` | Permission seeding |
| Setup Script | `docs/setup-storage.sh` | Automated setup |

---

## 📋 Pre-Deployment Checklist

Quick checklist for production:

```bash
# 1. Dependencies
npm install

# 2. Database
npx prisma migrate dev --name add_storage_tables
npx prisma generate

# 3. Permissions
npx ts-node prisma/seeds/storage.seed.ts

# 4. Environment (check all required vars)
env | grep -E "(AWS|AZURE)_"

# 5. Provider setup (S3 bucket or Azure container)
# - Bucket/container created
# - CORS configured
# - IAM/Access policy configured

# 6. Tests
npm run test:unit -- storage
npm run test:e2e -- storage

# 7. Start
npm run start:dev

# 8. Verify logs
# ✅ S3 Storage Provider registered
# ✅ Storage Cleanup Service initialized
```

---

## 📞 Support & Documentation

- **Setup Completo**: [21-STORAGE_SETUP.md](./21-STORAGE_SETUP.md)
- **Implementation Summary**: [23-STORAGE_IMPLEMENTATION.md](./23-STORAGE_IMPLEMENTATION.md)
- **Usage Guide**: [24-STORAGE_USAGE_GUIDE.md](./24-STORAGE_USAGE_GUIDE.md)

### Audit Logs Query

```sql
-- View all storage operations
SELECT 
  type,
  user_id,
  metadata->>'fileId' as file_id,
  metadata->>'fileName' as file_name,
  created_at
FROM audit_events 
WHERE type LIKE 'FILE_%'
ORDER BY created_at DESC 
LIMIT 50;
```

### Database Health Check

```sql
-- Storage usage by organization
SELECT 
  org_id,
  COUNT(*) as file_count,
  SUM(size_bytes) as total_bytes,
  ROUND(SUM(size_bytes) / 1024.0 / 1024.0 / 1024.0, 2) as total_gb
FROM files
WHERE deleted_at IS NULL
GROUP BY org_id
ORDER BY total_bytes DESC;

-- Upload session status distribution
SELECT 
  status, 
  COUNT(*) 
FROM upload_sessions 
GROUP BY status;
```

---

**Quick Start Complete!** 🎉

For complete details see [21-STORAGE_SETUP.md](./21-STORAGE_SETUP.md)
