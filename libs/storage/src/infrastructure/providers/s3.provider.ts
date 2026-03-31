import { Injectable, Logger } from '@nestjs/common';
import { IStorageProvider } from '../../domain/entities/storage-provider.interface';
import { S3StorageClient } from '../clients/s3.client';

/**
 * S3 implementation of the storage provider interface.
 * Delegates to S3StorageClient for AWS SDK operations.
 */
@Injectable()
export class S3Provider implements IStorageProvider {
  private readonly logger = new Logger(S3Provider.name);

  constructor(private readonly s3Client: S3StorageClient) {}

  async generateUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> {
    this.logger.debug(
      `Generating upload URL for key: ${key}, contentType: ${contentType}`,
    );
    return this.s3Client.generatePresignedUploadUrl(
      key,
      contentType,
      expiresIn,
    );
  }

  async generateDownloadUrl(key: string, expiresIn: number): Promise<string> {
    this.logger.debug(`Generating download URL for key: ${key}`);
    return this.s3Client.generatePresignedDownloadUrl(key, expiresIn);
  }

  async deleteObject(key: string): Promise<void> {
    this.logger.debug(`Deleting object with key: ${key}`);
    await this.s3Client.deleteObject(key);
  }

  async objectExists(key: string): Promise<boolean> {
    return this.s3Client.objectExists(key);
  }

  async getObjectSize(key: string): Promise<bigint> {
    return this.s3Client.getObjectSize(key);
  }

  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    this.logger.debug(`Uploading object to key: ${key}`);
    await this.s3Client.putObject(key, buffer, contentType);
  }
}
