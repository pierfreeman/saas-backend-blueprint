import { Injectable, Logger } from '@nestjs/common';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  BlockBlobClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import {
  IStorageProvider,
  MultipartUploadResult,
  PresignedPartUrlResult,
  PresignedDownloadUrlResult,
  CompletedPart,
  CompleteMultipartUploadResult,
} from './storage.provider.interface';
import { v4 as uuidv4 } from 'uuid';

export interface AzureBlobConfig {
  accountName: string;
  accountKey: string;
  endpoint?: string; // Optional custom endpoint
}

/**
 * Azure Blob Storage Provider
 *
 * Implements Azure Block Blob upload (equivalent to S3 multipart)
 * using Block IDs and presigned SAS URLs
 */
@Injectable()
export class AzureBlobStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(AzureBlobStorageProvider.name);
  private readonly blobServiceClient: BlobServiceClient;
  private readonly credential: StorageSharedKeyCredential;
  private readonly defaultExpiresIn = 3600; // 1 hour
  private readonly blockIdMap: Map<string, string[]> = new Map(); // uploadId -> blockIds

  constructor(config: AzureBlobConfig) {
    this.credential = new StorageSharedKeyCredential(config.accountName, config.accountKey);

    const endpoint = config.endpoint || `https://${config.accountName}.blob.core.windows.net`;

    this.blobServiceClient = new BlobServiceClient(endpoint, this.credential);

    this.logger.log(`AzureBlobStorageProvider initialized for account: ${config.accountName}`);
  }

  async createMultipartUpload(
    container: string,
    key: string,
    mimeType: string,
  ): Promise<MultipartUploadResult> {
    this.logger.debug(`Creating block blob upload: ${container}/${key}`);

    // Azure doesn't have a separate "create multipart" - we just generate a unique upload ID
    // and track block IDs
    const uploadId = uuidv4();
    this.blockIdMap.set(uploadId, []);

    // Verify container exists (optional - will auto-create on first block upload)
    const containerClient = this.blobServiceClient.getContainerClient(container);
    await containerClient.createIfNotExists();

    return {
      uploadId,
      storageKey: key,
      bucketOrContainer: container,
    };
  }

  async generatePresignedUploadPartUrl(
    container: string,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<PresignedPartUrlResult> {
    this.logger.debug(`Generating presigned URL for block ${partNumber}: ${container}/${key}`);

    const containerClient = this.blobServiceClient.getContainerClient(container);
    const blobClient = containerClient.getBlockBlobClient(key);

    // Generate block ID (base64 encoded, must be same length for all blocks)
    const blockId = this.generateBlockId(partNumber);

    // Store block ID for later commit
    const blockIds = this.blockIdMap.get(uploadId) || [];
    blockIds[partNumber - 1] = blockId;
    this.blockIdMap.set(uploadId, blockIds);

    // Generate SAS URL for staging block
    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiresIn * 1000);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: container,
        blobName: key,
        permissions: BlobSASPermissions.parse('w'), // Write permission
        startsOn,
        expiresOn,
      },
      this.credential,
    ).toString();

    // Azure Block Blob URL with blockId
    const url = `${blobClient.url}?comp=block&blockid=${encodeURIComponent(blockId)}&${sasToken}`;

    return {
      url,
      partNumber,
      expiresIn,
    };
  }

  async completeMultipartUpload(
    container: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<CompleteMultipartUploadResult> {
    this.logger.debug(
      `Completing block blob upload: ${container}/${key} with ${parts.length} blocks`,
    );

    const blockIds = this.blockIdMap.get(uploadId);
    if (!blockIds || blockIds.length === 0) {
      throw new Error(`No block IDs found for uploadId: ${uploadId}`);
    }

    // Sort parts by part number and extract committed block IDs
    const sortedBlockIds = parts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => blockIds[part.partNumber - 1]);

    const containerClient = this.blobServiceClient.getContainerClient(container);
    const blobClient = containerClient.getBlockBlobClient(key);

    // Commit block list
    await blobClient.commitBlockList(sortedBlockIds);

    // Cleanup
    this.blockIdMap.delete(uploadId);

    const properties = await blobClient.getProperties();

    return {
      location: blobClient.url,
      eTag: properties.etag || '',
    };
  }

  async abortMultipartUpload(container: string, key: string, uploadId: string): Promise<void> {
    this.logger.debug(`Aborting block blob upload: ${container}/${key}`);

    // Azure uncommitted blocks are automatically garbage collected after 7 days
    // We just remove our tracking
    this.blockIdMap.delete(uploadId);

    // Optionally delete the blob if it exists (partial upload cleanup)
    try {
      const containerClient = this.blobServiceClient.getContainerClient(container);
      const blobClient = containerClient.getBlockBlobClient(key);
      await blobClient.deleteIfExists();
    } catch (error) {
      this.logger.warn(`Failed to delete blob on abort: ${error}`);
    }
  }

  async generatePresignedDownloadUrl(
    container: string,
    key: string,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<PresignedDownloadUrlResult> {
    this.logger.debug(`Generating presigned download URL: ${container}/${key}`);

    const containerClient = this.blobServiceClient.getContainerClient(container);
    const blobClient = containerClient.getBlobClient(key);

    const startsOn = new Date();
    const expiresOn = new Date(startsOn.getTime() + expiresIn * 1000);

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: container,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'), // Read permission
        startsOn,
        expiresOn,
      },
      this.credential,
    ).toString();

    const url = `${blobClient.url}?${sasToken}`;

    return {
      url,
      expiresIn,
    };
  }

  async deleteObject(container: string, key: string): Promise<void> {
    this.logger.debug(`Deleting blob: ${container}/${key}`);

    const containerClient = this.blobServiceClient.getContainerClient(container);
    const blobClient = containerClient.getBlobClient(key);

    await blobClient.delete();
  }

  async objectExists(container: string, key: string): Promise<boolean> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(container);
      const blobClient = containerClient.getBlobClient(key);

      await blobClient.getProperties();
      return true;
    } catch (error) {
      if ((error as any).statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Generate a base64-encoded block ID
   * Azure requires all block IDs to be the same length
   */
  private generateBlockId(partNumber: number): string {
    const paddedPartNumber = partNumber.toString().padStart(6, '0');
    return Buffer.from(`block-${paddedPartNumber}`).toString('base64');
  }
}
