/**
 * Storage provider abstraction.
 * Allows implementation of S3, Azure Blob, GCS, or any S3-compatible storage.
 */
export interface IStorageProvider {
  /**
   * Generate a presigned URL for uploading a file.
   * @param key - Storage key (path) for the file
   * @param contentType - MIME type of the file
   * @param expiresIn - URL expiration in seconds
   * @returns Presigned upload URL
   */
  generateUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string>;

  /**
   * Generate a presigned URL for downloading a file.
   * @param key - Storage key (path) for the file
   * @param expiresIn - URL expiration in seconds
   * @returns Presigned download URL
   */
  generateDownloadUrl(key: string, expiresIn: number): Promise<string>;

  /**
   * Delete an object from storage.
   * @param key - Storage key (path) for the file
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Check if an object exists in storage.
   * @param key - Storage key (path) for the file
   * @returns True if the object exists
   */
  objectExists(key: string): Promise<boolean>;

  /**
   * Return the size in bytes of an object that is known to exist.
   * @param key - Storage key (path) for the file
   * @returns Size in bytes
   */
  getObjectSize(key: string): Promise<bigint>;

  /**
   * Upload a buffer directly to storage.
   * For use by internal workflows that bypass the presigned-URL upload flow.
   * @param key - Storage key (path) for the file
   * @param buffer - File content
   * @param contentType - MIME type of the file
   */
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;
}
