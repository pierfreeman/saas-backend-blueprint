export interface MultipartUploadResult {
  uploadId: string;
  storageKey: string;
  bucketOrContainer: string;
}

export interface PresignedPartUrlResult {
  url: string;
  partNumber: number;
  expiresIn: number; // seconds
}

export interface PresignedDownloadUrlResult {
  url: string;
  expiresIn: number; // seconds
}

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export interface CompleteMultipartUploadResult {
  location: string;
  eTag: string;
}

/**
 * Storage Provider Interface
 *
 * All storage providers (S3, Azure Blob, etc.) must implement this interface
 * to provide unified multipart upload and presigned URL functionality.
 */
export interface IStorageProvider {
  /**
   * Initialize a multipart upload session with the provider
   */
  createMultipartUpload(
    bucketOrContainer: string,
    storageKey: string,
    mimeType: string,
  ): Promise<MultipartUploadResult>;

  /**
   * Generate a presigned URL for uploading a specific part
   */
  generatePresignedUploadPartUrl(
    bucketOrContainer: string,
    storageKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<PresignedPartUrlResult>;

  /**
   * Complete the multipart upload
   */
  completeMultipartUpload(
    bucketOrContainer: string,
    storageKey: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<CompleteMultipartUploadResult>;

  /**
   * Abort the multipart upload and cleanup
   */
  abortMultipartUpload(
    bucketOrContainer: string,
    storageKey: string,
    uploadId: string,
  ): Promise<void>;

  /**
   * Generate a presigned URL for downloading a file
   */
  generatePresignedDownloadUrl(
    bucketOrContainer: string,
    storageKey: string,
    expiresIn?: number,
  ): Promise<PresignedDownloadUrlResult>;

  /**
   * Delete an object from storage
   */
  deleteObject(bucketOrContainer: string, storageKey: string): Promise<void>;

  /**
   * Check if object exists
   */
  objectExists(bucketOrContainer: string, storageKey: string): Promise<boolean>;
}
