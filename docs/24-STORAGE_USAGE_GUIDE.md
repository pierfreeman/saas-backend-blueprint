# 📘 Storage Module - Developer Usage Guide

Practical guide to use the storage module in your applications.

---

## 🎯 Overview

The storage module provides REST APIs to upload, download, delete and manage media files with multipart upload support up to 100GB+.

**Benefits:**
- Files uploaded **directly to S3/Azure** (no data through backend)
- Multipart upload for large files with **auto-resume**
- Automatic quota management based on subscription plan
- Automatic RBAC enforcement
- Audit logging on all operations

---

## 🔑 Authentication & Authorization

### Headers Required

All endpoints require:

```http
Authorization: Bearer <jwt_token>
x-org-id: <organization_id>
Content-Type: application/json
```

### RBAC Permissions

| Permission | Endpoints | Who has it |
|------------|-----------|------------|
| `file.upload` | Create/complete upload | Owner, Admin, Member, Coach |
| `file.read` | List/view/download files | Owner, Admin, Member, Coach |
| `file.delete` | Delete files | Owner, Admin, Coach |
| `file.manage` | All operations | Owner, Admin |

---

## 📤 Upload Flow (Client-Side)

### Step 1: Create Upload Session

```typescript
const createUploadSession = async (file: File) => {
  const response = await fetch('http://localhost:3000/storage/upload-session', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'x-org-id': orgId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      expectedSize: file.size,
      storageProvider: 'S3',  // or 'AZURE'
      entityType: 'TEAM',     // optional: ORG | TEAM | PLAYER | GENERIC
      entityId: 'team-uuid',  // optional
      visibility: 'PRIVATE'   // optional: PRIVATE | PUBLIC
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to create upload session');
  }
  
  return await response.json();
  // Returns:
  // {
  //   uploadSessionId: "uuid",
  //   uploadConfig: {
  //     uploadId: "provider-upload-id",
  //     storageKey: "org-id/2026-02-14-uuid.mp4",
  //     bucketOrContainer: "sports-intelligence-storage",
  //     partSize: 5242880,
  //     partCount: 20
  //   },
  //   expiresAt: "2026-02-15T12:00:00Z"
  // }
};
```

### Step 2: Upload Parts

```typescript
const uploadParts = async (
  file: File, 
  sessionId: string, 
  uploadConfig: any,
  onProgress?: (percent: number) => void
) => {
  const { partSize, partCount } = uploadConfig;
  const parts: Array<{ partNumber: number; eTag: string }> = [];
  
  for (let i = 1; i <= partCount; i++) {
    // Calculate chunk boundaries
    const start = (i - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const chunk = file.slice(start, end);
    
    // Get presigned URL for this part
    const presignedResponse = await fetch(
      `http://localhost:3000/storage/upload-session/${sessionId}/presigned-part`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
          'x-org-id': orgId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ partNumber: i })
      }
    );
    
    const { url } = await presignedResponse.json();
    
    // Upload chunk directly to S3/Azure
    const uploadResponse = await fetch(url, {
      method: 'PUT',
      body: chunk,
      headers: {
        'Content-Type': file.type
      }
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload part ${i}`);
    }
    
    // Extract ETag from response
    const eTag = uploadResponse.headers.get('ETag')?.replace(/"/g, '');
    parts.push({ partNumber: i, eTag: eTag! });
    
    // Report progress
    if (onProgress) {
      const progress = Math.round((i / partCount) * 100);
      onProgress(progress);
    }
  }
  
  return parts;
};
```

### Step 3: Complete Upload

```typescript
const completeUpload = async (
  sessionId: string,
  uploadConfig: any,
  parts: Array<{ partNumber: number; eTag: string }>
) => {
  const response = await fetch(
    `http://localhost:3000/storage/upload-session/${sessionId}/complete`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        storageKey: uploadConfig.storageKey,
        bucketOrContainer: uploadConfig.bucketOrContainer,
        parts: parts,
        checksum: 'optional-md5-checksum'  // optional
      })
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to complete upload');
  }
  
  return await response.json();
  // Returns:
  // {
  //   fileId: "file-uuid",
  //   fileName: "video.mp4",
  //   sizeBytes: "104857600",
  //   mimeType: "video/mp4",
  //   createdAt: "2026-02-14T12:00:00Z"
  // }
};
```

### Complete Example (React)

```tsx
import React, { useState } from 'react';

export const FileUploader: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setError(null);
    
    try {
      // Step 1: Create session
      const session = await createUploadSession(file);
      
      // Step 2: Upload parts
      const parts = await uploadParts(
        file, 
        session.uploadSessionId, 
        session.uploadConfig,
        setProgress
      );
      
      // Step 3: Complete upload
      const result = await completeUpload(
        session.uploadSessionId,
        session.uploadConfig,
        parts
      );
      
      console.log('Upload complete!', result);
      alert(`File ${result.fileName} uploaded successfully!`);
      
    } catch (err) {
      console.error('Upload failed:', err);
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div>
      <input 
        type="file" 
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={uploading}
      />
      <button onClick={handleUpload} disabled={!file || uploading}>
        {uploading ? `Uploading... ${progress}%` : 'Upload'}
      </button>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
};
```

---

## 📥 Download Flow

### Get Download URL

```typescript
const getDownloadUrl = async (fileId: string) => {
  const response = await fetch(
    `http://localhost:3000/storage/files/${fileId}/download-url`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to get download URL');
  }
  
  const { url, expiresIn } = await response.json();
  // url: presigned download URL (valid 1h)
  // expiresIn: 3600 (seconds)
  
  return url;
};

// Use in browser
const downloadFile = async (fileId: string) => {
  const url = await getDownloadUrl(fileId);
  window.open(url, '_blank');
};
```

---

## 🗂️ List Files

### Basic Listing

```typescript
const listFiles = async (params?: {
  limit?: number;
  offset?: number;
  entityType?: 'ORG' | 'TEAM' | 'PLAYER' | 'GENERIC';
  entityId?: string;
}) => {
  const queryParams = new URLSearchParams({
    limit: String(params?.limit || 100),
    offset: String(params?.offset || 0),
    ...(params?.entityType && { entityType: params.entityType }),
    ...(params?.entityId && { entityId: params.entityId })
  });
  
  const response = await fetch(
    `http://localhost:3000/storage/files?${queryParams}`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to list files');
  }
  
  return await response.json();
  // Returns:
  // {
  //   files: [
  //     {
  //       id: "file-uuid",
  //       fileName: "video.mp4",
  //       mimeType: "video/mp4",
  //       sizeBytes: "104857600",
  //       entityType: "TEAM",
  //       entityId: "team-uuid",
  //       visibility: "PRIVATE",
  //       createdAt: "2026-02-14T12:00:00Z"
  //     }
  //   ],
  //   count: 42
  // }
};
```

### Pagination Example

```typescript
const getAllTeamFiles = async (teamId: string) => {
  const allFiles = [];
  let offset = 0;
  const limit = 100;
  
  while (true) {
    const { files, count } = await listFiles({
      limit,
      offset,
      entityType: 'TEAM',
      entityId: teamId
    });
    
    allFiles.push(...files);
    
    if (offset + limit >= count) break;
    offset += limit;
  }
  
  return allFiles;
};
```

---

## 🗑️ Delete File

```typescript
const deleteFile = async (fileId: string) => {
  const response = await fetch(
    `http://localhost:3000/storage/files/${fileId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to delete file');
  }
  
  // Response 204 No Content
  console.log('File deleted successfully');
};
```

**Nota:** Delete è **soft delete** - file marcato con `deleted_at` ma non fisicamente rimosso da storage.

---

## 📊 Check Quota Usage

```typescript
const getQuotaUsage = async () => {
  const response = await fetch(
    'http://localhost:3000/storage/quota',
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId
      }
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to get quota');
  }
  
  return await response.json();
  // Returns:
  // {
  //   plan: "PRO",
  //   storageUsedBytes: "10737418240",
  //   storageLimitBytes: "53687091200",
  //   fileCount: 250,
  //   fileCountLimit: 10000,
  //   storagePercentage: 20.0,
  //   fileCountPercentage: 2.5
  // }
};

// Display quota to user
const displayQuota = async () => {
  const quota = await getQuotaUsage();
  
  const usedGB = (Number(quota.storageUsedBytes) / 1024 / 1024 / 1024).toFixed(2);
  const limitGB = (Number(quota.storageLimitBytes) / 1024 / 1024 / 1024).toFixed(2);
  
  console.log(`Storage: ${usedGB} GB / ${limitGB} GB (${quota.storagePercentage}%)`);
  console.log(`Files: ${quota.fileCount} / ${quota.fileCountLimit} (${quota.fileCountPercentage}%)`);
};
```

---

## ❌ Abort Upload

```typescript
const abortUpload = async (sessionId: string, reason?: string) => {
  const response = await fetch(
    `http://localhost:3000/storage/upload-session/${sessionId}/abort`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'x-org-id': orgId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reason: reason || 'User cancelled'
      })
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to abort upload');
  }
  
  // Response 204 No Content
  console.log('Upload aborted');
};
```

---

## 🔄 Resume Upload (Advanced)

Per implementare resume upload dopo errore:

```typescript
const resumableUpload = async (
  file: File,
  sessionId: string,
  uploadConfig: any,
  startFromPart: number = 1
) => {
  const { partSize, partCount } = uploadConfig;
  const parts: Array<{ partNumber: number; eTag: string }> = [];
  
  // Resume from specific part
  for (let i = startFromPart; i <= partCount; i++) {
    try {
      const start = (i - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunk = file.slice(start, end);
      
      // Get presigned URL
      const presignedResponse = await fetch(
        `http://localhost:3000/storage/upload-session/${sessionId}/presigned-part`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'x-org-id': orgId,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ partNumber: i })
        }
      );
      
      const { url } = await presignedResponse.json();
      
      // Upload with retry
      let uploadResponse;
      let retries = 3;
      
      while (retries > 0) {
        try {
          uploadResponse = await fetch(url, {
            method: 'PUT',
            body: chunk,
            headers: { 'Content-Type': file.type }
          });
          
          if (uploadResponse.ok) break;
        } catch (err) {
          console.warn(`Retry part ${i}, attempts left: ${retries - 1}`);
        }
        
        retries--;
        if (retries === 0) throw new Error(`Failed to upload part ${i} after 3 retries`);
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
      }
      
      const eTag = uploadResponse!.headers.get('ETag')?.replace(/"/g, '');
      parts.push({ partNumber: i, eTag: eTag! });
      
      // Save progress to localStorage for resume
      localStorage.setItem(`upload_${sessionId}`, JSON.stringify({
        lastCompletedPart: i,
        parts: parts
      }));
      
    } catch (error) {
      console.error(`Failed at part ${i}:`, error);
      throw error;
    }
  }
  
  return parts;
};

// Load saved progress
const loadUploadProgress = (sessionId: string) => {
  const saved = localStorage.getItem(`upload_${sessionId}`);
  if (!saved) return null;
  
  return JSON.parse(saved);
};
```

---

## 🚨 Error Handling

### Common Errors

```typescript
const handleUploadError = (error: any) => {
  if (error.response) {
    switch (error.response.status) {
      case 400:
        console.error('Bad request - check file size, mime type');
        break;
      case 401:
        console.error('Unauthorized - JWT token invalid or expired');
        break;
      case 403:
        console.error('Forbidden - missing required permission');
        break;
      case 409:
        console.error('Quota exceeded - upgrade plan or delete files');
        break;
      case 422:
        console.error('Validation error - check request body');
        break;
      default:
        console.error('Upload failed:', error.message);
    }
  } else {
    console.error('Network error:', error);
  }
};
```

### Validation Before Upload

```typescript
const validateFileBeforeUpload = async (file: File) => {
  // Check quota first
  const quota = await getQuotaUsage();
  
  // Check if file would exceed quota
  const afterUploadBytes = Number(quota.storageUsedBytes) + file.size;
  if (afterUploadBytes > Number(quota.storageLimitBytes)) {
    throw new Error(`Quota exceeded. You have ${quota.storageUsedBytes} bytes used and limit is ${quota.storageLimitBytes}`);
  }
  
  // Check file count
  if (quota.fileCount >= quota.fileCountLimit) {
    throw new Error(`File count limit reached (${quota.fileCountLimit})`);
  }
  
  // Check single file size limits
  const planLimits = {
    FREE: 100 * 1024 * 1024,      // 100 MB
    PRO: 20 * 1024 * 1024 * 1024, // 20 GB
    ENTERPRISE: 100 * 1024 * 1024 * 1024 // 100 GB
  };
  
  if (file.size > planLimits[quota.plan]) {
    throw new Error(`File too large. Max file size for ${quota.plan} plan: ${planLimits[quota.plan]} bytes`);
  }
  
  return true;
};
```

---

## 🎨 UI Components Examples

### Upload Progress Bar (React)

```tsx
export const UploadProgressBar: React.FC<{
  progress: number;
  fileName: string;
}> = ({ progress, fileName }) => (
  <div style={{ padding: '10px', border: '1px solid #ccc' }}>
    <div>{fileName}</div>
    <div style={{ 
      width: '100%', 
      background: '#eee', 
      height: '20px',
      borderRadius: '10px',
      overflow: 'hidden'
    }}>
      <div style={{
        width: `${progress}%`,
        background: '#4caf50',
        height: '100%',
        transition: 'width 0.3s'
      }} />
    </div>
    <div>{progress}%</div>
  </div>
);
```

### File List (React)

```tsx
export const FileList: React.FC<{
  files: any[];
  onDownload: (fileId: string) => void;
  onDelete: (fileId: string) => void;
}> = ({ files, onDownload, onDelete }) => (
  <div>
    <h3>Files ({files.length})</h3>
    <ul>
      {files.map(file => (
        <li key={file.id}>
          <span>{file.fileName}</span>
          <span>{(Number(file.sizeBytes) / 1024 / 1024).toFixed(2)} MB</span>
          <button onClick={() => onDownload(file.id)}>Download</button>
          <button onClick={() => onDelete(file.id)}>Delete</button>
        </li>
      ))}
    </ul>
  </div>
);
```

---

## 🔔 Event Listeners (Worker Integration)

Se hai worker che processano file:

```typescript
// Worker subscribes to storage events
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class FileProcessorWorker {
  constructor(private readonly eventEmitter: EventEmitter2) {
    this.eventEmitter.on('FILE_UPLOADED', this.handleFileUploaded.bind(this));
    this.eventEmitter.on('FILE_DELETED', this.handleFileDeleted.bind(this));
  }
  
  private async handleFileUploaded(event: FileUploadedEvent) {
    console.log('New file uploaded:', event.fileId);
    
    // Process video
    if (event.mimeType.startsWith('video/')) {
      await this.transcodeVideo(event.fileId);
    }
    
    // Generate thumbnail
    if (event.mimeType.startsWith('image/')) {
      await this.generateThumbnail(event.fileId);
    }
  }
  
  private async handleFileDeleted(event: FileDeletedEvent) {
    console.log('File deleted:', event.fileId);
    // Cleanup related resources
  }
}
```

---

## 📋 Best Practices

### 1. Always Validate Quota Before Upload

```typescript
await validateFileBeforeUpload(file);
const session = await createUploadSession(file);
```

### 2. Implement Retry Logic

```typescript
const uploadWithRetry = async (url: string, chunk: Blob, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { method: 'PUT', body: chunk });
      if (response.ok) return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
};
```

### 3. Save Upload Progress

```typescript
localStorage.setItem(`upload_${sessionId}`, JSON.stringify({
  lastCompletedPart: partNumber,
  parts: uploadedParts
}));
```

### 4. Handle Upload Cancellation

```typescript
const abortController = new AbortController();

// User clicks cancel
cancelButton.onclick = () => {
  abortController.abort();
  abortUpload(sessionId, 'User cancelled');
};

// Use in fetch
fetch(url, {
  method: 'PUT',
  body: chunk,
  signal: abortController.signal
});
```

### 5. Display Meaningful Errors

```typescript
const getErrorMessage = (error: any): string => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  switch (error.response?.status) {
    case 409: return 'Storage quota exceeded. Please upgrade your plan.';
    case 413: return 'File too large for your plan.';
    case 401: return 'Session expired. Please login again.';
    default: return 'Upload failed. Please try again.';
  }
};
```

---

## 📚 Additional Resources

- **[21-STORAGE_SETUP.md](./21-STORAGE_SETUP.md)** - Complete setup guide
- **[22-STORAGE_QUICK_START.md](./22-STORAGE_QUICK_START.md)** - Quick start in 5 min
- **[23-STORAGE_IMPLEMENTATION.md](./23-STORAGE_IMPLEMENTATION.md)** - Implementation summary

---

**Happy Coding!** 🚀
