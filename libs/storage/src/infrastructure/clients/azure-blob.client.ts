import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from '@azure/storage-blob';
import type { StorageConfig } from '@libs/config';

/**
 * AzureBlobStorageClient — wrapper around the Azure Blob Storage SDK.
 *
 * Handles connection configuration and provides methods for Azure Blob operations.
 * Mirrors the shape of S3StorageClient to allow transparent provider switching.
 *
 * Required environment variables when DEFAULT_STORAGE_PROVIDER=AZURE:
 *   AZURE_STORAGE_ACCOUNT     Azure Storage account name
 *   AZURE_STORAGE_KEY         Azure Storage account key
 *   AZURE_STORAGE_CONTAINER   Blob container name
 *   AZURE_STORAGE_ENDPOINT    (optional) Custom endpoint for Azurite in local dev
 *                             e.g. http://azurite:10000/devstoreaccount1
 */
@Injectable()
export class AzureBlobStorageClient {
  private readonly logger = new Logger(AzureBlobStorageClient.name);
  private readonly serviceClient: BlobServiceClient;
  private readonly container: string;
  private readonly credential: StorageSharedKeyCredential;

  constructor(private readonly configService: ConfigService) {
    const azureConfig =
      this.configService.get<StorageConfig['azure']>('storage.azure')!;

    this.container = azureConfig.container;
    this.credential = new StorageSharedKeyCredential(
      azureConfig.storageAccount,
      azureConfig.storageKey,
    );

    // Support custom endpoint for local dev (Azurite).
    const endpoint =
      azureConfig.endpoint ??
      `https://${azureConfig.storageAccount}.blob.core.windows.net`;

    this.serviceClient = new BlobServiceClient(endpoint, this.credential);
    this.logger.log(
      `AzureBlobStorageClient initialized: container=${this.container}`,
    );
  }

  private getBlockBlobClient(key: string) {
    return this.serviceClient
      .getContainerClient(this.container)
      .getBlockBlobClient(key);
  }

  /**
   * Generate a SAS URL for uploading a blob (write + create permissions).
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> {
    const blobClient = this.getBlockBlobClient(key);
    const sasParams = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName: key,
        // 'c' = create, 'w' = write — required to PUT a new blob
        permissions: BlobSASPermissions.parse('cw'),
        expiresOn: new Date(Date.now() + expiresIn * 1000),
        contentType,
      },
      this.credential,
    );
    return `${blobClient.url}?${sasParams.toString()}`;
  }

  /**
   * Generate a SAS URL for downloading a blob (read permission).
   */
  async generatePresignedDownloadUrl(
    key: string,
    expiresIn: number,
  ): Promise<string> {
    const blobClient = this.getBlockBlobClient(key);
    const sasParams = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName: key,
        permissions: BlobSASPermissions.parse('r'),
        expiresOn: new Date(Date.now() + expiresIn * 1000),
      },
      this.credential,
    );
    return `${blobClient.url}?${sasParams.toString()}`;
  }

  /**
   * Delete a blob from the container.
   */
  async deleteObject(key: string): Promise<void> {
    await this.getBlockBlobClient(key).delete();
    this.logger.debug(`Deleted blob: ${key}`);
  }

  /**
   * Check whether a blob exists in the container.
   */
  async objectExists(key: string): Promise<boolean> {
    return this.getBlockBlobClient(key).exists();
  }

  /**
   * Return the size of a blob in bytes.
   * Assumes the blob exists; call objectExists first if unsure.
   */
  async getObjectSize(key: string): Promise<bigint> {
    const props = await this.getBlockBlobClient(key).getProperties();
    return BigInt(props.contentLength ?? 0);
  }

  /**
   * Upload a buffer directly to Azure Blob Storage.
   */
  async putObject(
    key: string,
    buffer: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.getBlockBlobClient(key).upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    this.logger.debug(`Uploaded blob: ${key}`);
  }

  /**
   * Return the configured container name (for testing).
   */
  getContainer(): string {
    return this.container;
  }
}
