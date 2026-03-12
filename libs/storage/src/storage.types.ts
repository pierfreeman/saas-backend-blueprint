import { FileStatus, StorageProvider } from './domain/enums/storage.enums';

export type PlanType = 'free' | 'pro' | 'enterprise';

/**
 * Request to generate an upload URL.
 */
export interface GenerateUploadUrlRequest {
  orgId: string;
  userId: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Response containing the presigned upload URL.
 */
export interface GenerateUploadUrlResponse {
  fileId: string;
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
}

/**
 * Request to confirm a file upload.
 */
export interface ConfirmUploadRequest {
  fileId: string;
  orgId: string;
  userId: string;
}

/**
 * Response after confirming an upload.
 */
export interface ConfirmUploadResponse {
  fileId: string;
  status: FileStatus;
  confirmedAt: Date;
}

/**
 * Request to generate a download URL.
 */
export interface GenerateDownloadUrlRequest {
  fileId: string;
  orgId: string;
  userId: string;
}

/**
 * Response containing the presigned download URL.
 */
export interface GenerateDownloadUrlResponse {
  downloadUrl: string;
  expiresAt: Date;
  filename: string;
  mimeType: string | null;
  size: bigint | null;
}

/**
 * Request to delete a file.
 */
export interface DeleteFileRequest {
  fileId: string;
  orgId: string;
  userId: string;
}

/**
 * File metadata entity.
 */
export interface FileMetadata {
  id: string;
  orgId: string;
  uploadedBy: string;
  storageKey: string;
  provider: StorageProvider;
  filename: string;
  size: bigint | null;
  mimeType: string | null;
  status: FileStatus;
  expiresAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Upload policy configuration.
 */
export interface UploadPolicy {
  maxFileSizeBytes: number;
  allowedMimeTypes?: string[];
  forbiddenMimeTypes?: string[];
}

/**
 * Storage quota information for an organization.
 */
export interface StorageQuota {
  storageLimitBytes: bigint | null;
  storageUsedBytes: bigint;
  fileCount: number;
  fileCountLimit: number | null;
  maxFileSizeBytes: number;
}
