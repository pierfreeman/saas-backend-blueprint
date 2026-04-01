import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { IStorageProvider } from '../../domain/entities/storage-provider.interface';
import { FileStatus, StorageProvider } from '../../domain/enums/storage.enums';
import { S3Provider } from '../../infrastructure/providers/s3.provider';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';
import {
  ConfirmUploadRequest,
  ConfirmUploadResponse,
  DeleteFileRequest,
  FileMetadata,
  GenerateDownloadUrlRequest,
  GenerateDownloadUrlResponse,
  GenerateUploadUrlRequest,
  GenerateUploadUrlResponse,
  PlanType,
} from '../../domain/types';
import { UploadPolicyService } from './upload-policy.service';

/**
 * Main storage service for managing file uploads and downloads.
 * Enforces tenant isolation, quota limits, and audit logging.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly defaultProvider: StorageProvider;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Provider: S3Provider,
    private readonly storageRepository: StorageRepository,
    private readonly uploadPolicyService: UploadPolicyService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {
    const defaultProviderStr = this.configService.get<string>(
      'storage.defaultProvider',
    );
    this.defaultProvider =
      defaultProviderStr === 'AZURE'
        ? StorageProvider.AZURE
        : StorageProvider.S3;
  }

  /**
   * Generate a presigned upload URL for a new file.
   */
  async generateUploadUrl(
    request: GenerateUploadUrlRequest,
    planType: PlanType = 'free',
    orgStorageLimit?: bigint | null,
  ): Promise<GenerateUploadUrlResponse> {
    const { orgId, userId, filename, mimeType, size } = request;

    // Validate upload request against policy
    await this.uploadPolicyService.validateUploadRequest(
      orgId,
      filename,
      mimeType,
      size,
      planType,
      orgStorageLimit,
    );

    // Generate file ID and storage key
    const fileId = randomUUID();
    const storageKey = this.generateStorageKey(orgId, fileId);

    // Get presigned URL expiration
    const expirationSeconds =
      this.configService.get<number>(
        'storage.presignedUrl.expirationSeconds',
      ) ?? 3600;
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

    // Get storage provider
    const provider = this.getProvider(this.defaultProvider);

    // Generate presigned upload URL
    const uploadUrl = await provider.generateUploadUrl(
      storageKey,
      mimeType,
      expirationSeconds,
    );

    // Create file metadata record
    await this.storageRepository.createFile({
      id: fileId,
      orgId,
      uploadedBy: userId,
      storageKey,
      provider: this.defaultProvider,
      filename,
      mimeType,
      expiresAt,
    });

    // Log activity
    this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'file.upload.requested',
      entityType: 'File',
      entityId: fileId,
      metadata: { filename, size, mimeType },
    });

    // Legal audit
    this.legalAudit.recordEvent({
      eventType: 'file.upload.requested',
      orgId,
      triggerType: 'user_action',
      metadata: { fileId, filename, size },
    });

    this.logger.log(
      `Upload URL generated for org ${orgId}, file ${fileId}: ${filename}`,
    );

    return {
      fileId,
      uploadUrl,
      storageKey,
      expiresAt,
    };
  }

  /**
   * Confirm that a file upload has been completed.
   */
  async confirmUpload(
    request: ConfirmUploadRequest,
  ): Promise<ConfirmUploadResponse> {
    const { fileId, orgId, userId } = request;

    // Verify file exists and belongs to org
    const file = await this.storageRepository.findByIdAndOrg(fileId, orgId);
    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    // Verify file is in PENDING state
    if (file.status !== FileStatus.PENDING) {
      throw new BadRequestException(
        `File ${fileId} is not in PENDING state (current: ${file.status})`,
      );
    }

    // Verify not expired
    if (file.expiresAt && file.expiresAt < new Date()) {
      await this.storageRepository.markExpired(fileId);
      throw new BadRequestException(
        `File ${fileId} upload session has expired`,
      );
    }

    // Verify file exists in storage and retrieve its actual size
    const provider = this.getProvider(file.provider);
    const exists = await provider.objectExists(file.storageKey);
    if (!exists) {
      throw new BadRequestException(
        `File ${fileId} has not been uploaded to storage`,
      );
    }

    const actualSize = await provider.getObjectSize(file.storageKey);

    // Mark as confirmed, persisting the real size from storage
    const confirmedFile = await this.storageRepository.confirmUpload(
      fileId,
      actualSize,
    );

    // Log activity
    this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'file.upload.confirmed',
      entityType: 'File',
      entityId: fileId,
      metadata: { filename: file.filename },
    });

    // Legal audit
    this.legalAudit.recordEvent({
      eventType: 'file.upload.confirmed',
      orgId,
      triggerType: 'user_action',
      metadata: { fileId, filename: file.filename },
    });

    this.logger.log(`Upload confirmed for org ${orgId}, file ${fileId}`);

    return {
      fileId: confirmedFile.id,
      status: confirmedFile.status,
      confirmedAt: confirmedFile.confirmedAt ?? new Date(),
    };
  }

  /**
   * Generate a presigned download URL for a file.
   */
  async generateDownloadUrl(
    request: GenerateDownloadUrlRequest,
  ): Promise<GenerateDownloadUrlResponse> {
    const { fileId, orgId, userId } = request;

    // Verify file exists and belongs to org
    const file = await this.storageRepository.findByIdAndOrg(fileId, orgId);
    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    // Verify file is completed
    if (file.status !== FileStatus.COMPLETED) {
      throw new ForbiddenException(
        `File ${fileId} is not available for download (status: ${file.status})`,
      );
    }

    // Get presigned URL expiration
    const expirationSeconds =
      this.configService.get<number>(
        'storage.presignedUrl.expirationSeconds',
      ) ?? 3600;
    const expiresAt = new Date(Date.now() + expirationSeconds * 1000);

    // Generate presigned download URL
    const provider = this.getProvider(file.provider);
    const downloadUrl = await provider.generateDownloadUrl(
      file.storageKey,
      expirationSeconds,
    );

    // Log activity
    this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'file.download.requested',
      entityType: 'File',
      entityId: fileId,
      metadata: { filename: file.filename },
    });

    this.logger.log(`Download URL generated for org ${orgId}, file ${fileId}`);

    return {
      downloadUrl,
      expiresAt,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  /**
   * Delete a file.
   */
  async deleteFile(request: DeleteFileRequest): Promise<void> {
    const { fileId, orgId, userId } = request;

    // Verify file exists and belongs to org
    const file = await this.storageRepository.findByIdAndOrg(fileId, orgId);
    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }

    // Delete from storage if completed
    if (file.status === FileStatus.COMPLETED) {
      const provider = this.getProvider(file.provider);
      try {
        await provider.deleteObject(file.storageKey);
      } catch (error) {
        this.logger.warn(
          `Failed to delete file ${fileId} from storage: ${error}`,
        );
        // Continue with metadata deletion even if storage deletion fails
      }
    }

    // Delete metadata
    await this.storageRepository.deleteFile(fileId);

    // Log activity
    this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'file.deleted',
      entityType: 'File',
      entityId: fileId,
      metadata: { filename: file.filename },
    });

    // Legal audit
    this.legalAudit.recordEvent({
      eventType: 'file.deleted',
      orgId,
      triggerType: 'user_action',
      metadata: { fileId, filename: file.filename },
    });

    this.logger.log(`File deleted for org ${orgId}, file ${fileId}`);
  }

  /**
   * Get file metadata.
   */
  async getFile(fileId: string, orgId: string): Promise<FileMetadata> {
    const file = await this.storageRepository.findByIdAndOrg(fileId, orgId);
    if (!file) {
      throw new NotFoundException(`File ${fileId} not found`);
    }
    return file;
  }

  /**
   * List files for an organization.
   */
  async listFiles(
    orgId: string,
    options?: {
      status?: FileStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<FileMetadata[]> {
    return this.storageRepository.findByOrg(orgId, options);
  }

  /**
   * Delete all files stored under the given key prefix (e.g. "org/{orgId}").
   * Deletes each file from the storage provider; DB metadata cleanup is
   * expected to be handled separately (e.g. via Prisma deleteMany).
   */
  async deleteFolder(prefix: string): Promise<void> {
    this.logger.log(`Deleting all storage objects under prefix: ${prefix}`);
    const files = await this.storageRepository.findByPrefix(prefix);
    for (const file of files) {
      if (file.status === FileStatus.COMPLETED) {
        try {
          const provider = this.getProvider(file.provider);
          await provider.deleteObject(file.storageKey);
        } catch (error) {
          this.logger.warn(
            `Failed to delete storage object ${file.storageKey}: ${error}`,
          );
        }
      }
    }
    this.logger.log(
      `Deleted ${files.length} storage objects under prefix: ${prefix}`,
    );
  }

  /**
   * Generate storage key for a file.
   * Format: org/{orgId}/{fileId}
   */
  private generateStorageKey(orgId: string, fileId: string): string {
    return `org/${orgId}/${fileId}`;
  }

  /**
   * Get storage provider by type.
   */
  private getProvider(providerType: StorageProvider): IStorageProvider {
    switch (providerType) {
      case StorageProvider.S3:
        return this.s3Provider;
      case StorageProvider.AZURE:
        // TODO: Implement Azure provider
        throw new Error('Azure provider not yet implemented');
      default:
        throw new Error(`Unsupported storage provider: ${providerType}`);
    }
  }

  /**
   * Generate a presigned download URL for a raw storage key.
   * For use by internal workflows (e.g. org export) that upload files directly
   * without creating a tracked database record.
   */
  async generateRawPresignedDownloadUrl(
    storageKey: string,
    expirationSeconds: number,
  ): Promise<string> {
    const provider = this.getProvider(this.defaultProvider);
    return provider.generateDownloadUrl(storageKey, expirationSeconds);
  }

  /**
   * Upload a buffer directly to storage.
   * For use by internal workflows (e.g. org export) that bypass the presigned
   * upload URL flow.
   */
  async putRawObject(
    storageKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const provider = this.getProvider(this.defaultProvider);
    await provider.putObject(storageKey, buffer, contentType);
  }
}
