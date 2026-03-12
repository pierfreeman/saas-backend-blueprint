/**
 * Storage provider types supported by the system.
 */
export enum StorageProvider {
  S3 = 'S3',
  AZURE = 'AZURE',
}

/**
 * File upload/processing status.
 */
export enum FileStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  ABORTED = 'ABORTED',
}
