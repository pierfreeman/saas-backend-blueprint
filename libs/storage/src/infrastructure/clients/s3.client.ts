import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from '@libs/config';

/**
 * S3Client wrapper for AWS S3 operations.
 * Handles connection configuration and provides methods for S3 operations.
 */
@Injectable()
export class S3StorageClient {
  private readonly logger = new Logger(S3StorageClient.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const storageConfig =
      this.configService.get<StorageConfig['s3']>('storage.s3')!;

    this.bucket = storageConfig.bucket;

    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: storageConfig.region,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
    };

    // Support S3-compatible providers (MinIO, LocalStack, etc.)
    if (storageConfig.endpoint) {
      clientConfig.endpoint = storageConfig.endpoint;
      clientConfig.forcePathStyle = true; // Required for LocalStack and MinIO
    }

    this.client = new S3Client(clientConfig);
    this.logger.log(
      `S3Client initialized: region=${storageConfig.region}, bucket=${this.bucket}`,
    );
  }

  /**
   * Generate a presigned URL for uploading an object.
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Generate a presigned URL for downloading an object.
   */
  async generatePresignedDownloadUrl(
    key: string,
    expiresIn: number,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Delete an object from S3.
   */
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
    this.logger.debug(`Deleted object: ${key}`);
  }

  /**
   * Check if an object exists in S3.
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'NotFound'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get the configured bucket name.
   */
  getBucket(): string {
    return this.bucket;
  }
}
