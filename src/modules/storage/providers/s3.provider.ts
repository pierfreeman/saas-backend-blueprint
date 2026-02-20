import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  IStorageProvider,
  MultipartUploadResult,
  PresignedPartUrlResult,
  PresignedDownloadUrlResult,
  CompletedPart,
  CompleteMultipartUploadResult,
} from './storage.provider.interface';

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string; // Optional for S3-compatible services
}

/**
 * AWS S3 Storage Provider
 *
 * Implements native S3 multipart upload with presigned URLs
 */
@Injectable()
export class S3StorageProvider implements IStorageProvider {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly s3Client: S3Client;
  private readonly defaultExpiresIn = 3600; // 1 hour

  constructor(config: S3Config) {
    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
    });

    this.logger.log(`S3StorageProvider initialized for region: ${config.region}`);
  }

  async createMultipartUpload(
    bucket: string,
    key: string,
    mimeType: string,
  ): Promise<MultipartUploadResult> {
    this.logger.debug(`Creating multipart upload: ${bucket}/${key}`);

    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
    });

    const response = await this.s3Client.send(command);

    if (!response.UploadId) {
      throw new Error('Failed to create multipart upload: No UploadId returned');
    }

    return {
      uploadId: response.UploadId,
      storageKey: key,
      bucketOrContainer: bucket,
    };
  }

  async generatePresignedUploadPartUrl(
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<PresignedPartUrlResult> {
    this.logger.debug(`Generating presigned URL for part ${partNumber}: ${bucket}/${key}`);

    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      url,
      partNumber,
      expiresIn,
    };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<CompleteMultipartUploadResult> {
    this.logger.debug(`Completing multipart upload: ${bucket}/${key} with ${parts.length} parts`);

    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.eTag,
        })),
      },
    });

    const response = await this.s3Client.send(command);

    return {
      location: response.Location || `s3://${bucket}/${key}`,
      eTag: response.ETag || '',
    };
  }

  async abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<void> {
    this.logger.debug(`Aborting multipart upload: ${bucket}/${key}`);

    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });

    await this.s3Client.send(command);
  }

  async generatePresignedDownloadUrl(
    bucket: string,
    key: string,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<PresignedDownloadUrlResult> {
    this.logger.debug(`Generating presigned download URL: ${bucket}/${key}`);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      url,
      expiresIn,
    };
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.logger.debug(`Deleting object: ${bucket}/${key}`);

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error) {
      if ((error as any).name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }
}
