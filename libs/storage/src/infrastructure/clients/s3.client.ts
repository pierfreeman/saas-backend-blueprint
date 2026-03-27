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
  /** Optional public-facing origin to rewrite in presigned URLs (local dev). */
  private readonly publicEndpoint?: string;

  constructor(private readonly configService: ConfigService) {
    const storageConfig =
      this.configService.get<StorageConfig['s3']>('storage.s3')!;

    this.bucket = storageConfig.bucket;
    this.publicEndpoint = storageConfig.publicEndpoint;

    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: storageConfig.region,
      credentials: {
        accessKeyId: storageConfig.accessKeyId,
        secretAccessKey: storageConfig.secretAccessKey,
      },
      // Only compute / require checksums when the S3 API explicitly requires
      // them. Without this, SDK v3 injects x-amz-checksum-crc32 into presigned
      // PUT URLs, which browsers cannot satisfy via a plain fetch() PUT.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.rewritePublicEndpoint(url);
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

    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.rewritePublicEndpoint(url);
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
   * Return the size of an object in bytes via HeadObject.
   * Assumes the object exists; call objectExists first if unsure.
   */
  async getObjectSize(key: string): Promise<bigint> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    return BigInt(response.ContentLength ?? 0);
  }

  /**
   * Upload a buffer directly to S3.
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);
    this.logger.debug(`Uploaded object: ${key}`);
  }

  /**
   * Get the configured bucket name.
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Rewrites the origin of a presigned URL to the publicEndpoint when set.
   * This is needed in local dev where the S3Client endpoint is an internal
   * Docker hostname (e.g. http://localstack:4566) but browsers must reach
   * LocalStack via http://localhost:4566.
   */
  private rewritePublicEndpoint(url: string): string {
    if (!this.publicEndpoint || !this.client.config.endpoint) return url;
    try {
      const parsed = new URL(url);
      const pub = new URL(this.publicEndpoint);
      parsed.protocol = pub.protocol;
      parsed.hostname = pub.hostname;
      parsed.port = pub.port;
      return parsed.toString();
    } catch {
      return url;
    }
  }
}
