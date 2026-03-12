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
}
