import { Injectable, Logger } from '@nestjs/common';
import { IStorageProvider } from '../../domain/entities/storage-provider.interface';
import { AzureBlobStorageClient } from '../clients/azure-blob.client';

/**
 * Azure Blob Storage implementation of the storage provider interface.
 * Delegates to AzureBlobStorageClient for SDK operations.
 */
@Injectable()
export class AzureBlobProvider implements IStorageProvider {
  private readonly logger = new Logger(AzureBlobProvider.name);

  constructor(private readonly azureClient: AzureBlobStorageClient) {}

  async generateUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> {
    this.logger.debug(
      `Generating upload URL for key: ${key}, contentType: ${contentType}`,
    );
    return this.azureClient.generatePresignedUploadUrl(
      key,
      contentType,
      expiresIn,
    );
  }

  async generateDownloadUrl(key: string, expiresIn: number): Promise<string> {
    this.logger.debug(`Generating download URL for key: ${key}`);
    return this.azureClient.generatePresignedDownloadUrl(key, expiresIn);
  }

  async deleteObject(key: string): Promise<void> {
    this.logger.debug(`Deleting blob with key: ${key}`);
    await this.azureClient.deleteObject(key);
  }

  async objectExists(key: string): Promise<boolean> {
    return this.azureClient.objectExists(key);
  }

  async getObjectSize(key: string): Promise<bigint> {
    return this.azureClient.getObjectSize(key);
  }

  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    this.logger.debug(`Uploading blob to key: ${key}`);
    await this.azureClient.putObject(key, buffer, contentType);
  }
}
