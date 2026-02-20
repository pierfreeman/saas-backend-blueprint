import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorageProvider } from '@prisma/client';
import { IStorageProvider } from '../providers/storage.provider.interface';
import { UploadSessionService } from './upload-session.service';
import { FileMetadataService } from './file-metadata.service';
import { CompletedPart } from '../providers/storage.provider.interface';

/**
 * Multipart Upload Service
 *
 * Coordinates multipart upload operations between upload sessions
 * and storage providers (S3, Azure)
 */
@Injectable()
export class MultipartUploadService {
  private readonly logger = new Logger(MultipartUploadService.name);
  private readonly providers: Map<StorageProvider, IStorageProvider> = new Map();

  constructor(
    private readonly uploadSessionService: UploadSessionService,
    private readonly fileMetadataService: FileMetadataService,
  ) {}

  /**
   * Register a storage provider
   */
  registerProvider(providerType: StorageProvider, provider: IStorageProvider): void {
    this.providers.set(providerType, provider);
    this.logger.log(`Registered storage provider: ${providerType}`);
  }

  /**
   * Get provider instance
   */
  private getProvider(providerType: StorageProvider): IStorageProvider {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new BadRequestException(`Storage provider not configured: ${providerType}`);
    }
    return provider;
  }

  /**
   * Initialize multipart upload with provider
   */
  async initializeMultipartUpload(
    sessionId: string,
    bucketOrContainer: string,
    storageKey: string,
  ): Promise<string> {
    const session = await this.uploadSessionService.findByIdOrFail(sessionId);
    const provider = this.getProvider(session.storageProvider);

    this.logger.debug(`Initializing multipart upload for session: ${sessionId}`);

    const result = await provider.createMultipartUpload(
      bucketOrContainer,
      storageKey,
      session.mimeType,
    );

    return result.uploadId;
  }

  /**
   * Generate presigned URL for uploading a part
   */
  async generatePresignedPartUrl(
    sessionId: string,
    bucketOrContainer: string,
    storageKey: string,
    partNumber: number,
    expiresIn?: number,
  ): Promise<string> {
    const session = await this.uploadSessionService.validateSession(sessionId);

    if (!session.uploadProviderId) {
      throw new BadRequestException('Upload not initialized with provider');
    }

    const provider = this.getProvider(session.storageProvider);

    const result = await provider.generatePresignedUploadPartUrl(
      bucketOrContainer,
      storageKey,
      session.uploadProviderId,
      partNumber,
      expiresIn,
    );

    return result.url;
  }

  /**
   * Complete multipart upload
   */
  async completeMultipartUpload(
    sessionId: string,
    bucketOrContainer: string,
    storageKey: string,
    parts: CompletedPart[],
    checksum?: string,
  ): Promise<string> {
    const session = await this.uploadSessionService.validateSession(sessionId);

    if (!session.uploadProviderId) {
      throw new BadRequestException('Upload not initialized with provider');
    }

    const provider = this.getProvider(session.storageProvider);

    this.logger.debug(`Completing multipart upload for session: ${sessionId}`);

    // Complete with provider
    const result = await provider.completeMultipartUpload(
      bucketOrContainer,
      storageKey,
      session.uploadProviderId,
      parts,
    );

    // Mark session as completed
    await this.uploadSessionService.completeSession(sessionId);

    // Create file metadata
    const file = await this.fileMetadataService.createFile({
      orgId: session.orgId,
      uploadedByUserId: session.userId,
      storageProvider: session.storageProvider,
      bucketOrContainer,
      storageKey,
      fileName: session.fileName,
      mimeType: session.mimeType,
      sizeBytes: session.expectedSize,
      checksum,
    });

    this.logger.log(`Multipart upload completed. File ID: ${file.id}`);

    return file.id;
  }

  /**
   * Abort multipart upload
   */
  async abortMultipartUpload(
    sessionId: string,
    bucketOrContainer: string,
    storageKey: string,
  ): Promise<void> {
    const session = await this.uploadSessionService.findByIdOrFail(sessionId);

    if (!session.uploadProviderId) {
      this.logger.warn(`No provider upload ID for session ${sessionId}, skipping abort`);
      await this.uploadSessionService.abortSession(sessionId);
      return;
    }

    const provider = this.getProvider(session.storageProvider);

    this.logger.debug(`Aborting multipart upload for session: ${sessionId}`);

    try {
      await provider.abortMultipartUpload(bucketOrContainer, storageKey, session.uploadProviderId);
    } catch (error) {
      this.logger.error(`Failed to abort with provider: ${error}`);
      // Continue anyway to mark session as aborted
    }

    await this.uploadSessionService.abortSession(sessionId);
  }

  /**
   * Calculate recommended part size for multipart upload
   * AWS S3: min 5MB (except last part), max 5GB per part, max 10,000 parts
   * Azure: max 50,000 blocks, max 4000 MiB per block
   */
  calculatePartSize(fileSizeBytes: number): { partSize: number; partCount: number } {
    const MIN_PART_SIZE = 5 * 1024 * 1024; // 5MB
    const MAX_PART_SIZE = 100 * 1024 * 1024; // 100MB
    const MAX_PARTS = 10000;

    let partSize = MIN_PART_SIZE;
    let partCount = Math.ceil(fileSizeBytes / partSize);

    // If we exceed max parts, increase part size
    if (partCount > MAX_PARTS) {
      partSize = Math.ceil(fileSizeBytes / MAX_PARTS);
      partCount = Math.ceil(fileSizeBytes / partSize);
    }

    // Cap at max part size
    if (partSize > MAX_PART_SIZE) {
      partSize = MAX_PART_SIZE;
      partCount = Math.ceil(fileSizeBytes / partSize);
    }

    return { partSize, partCount };
  }
}
