import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import type { StorageConfig } from '@libs/config';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { StorageProvider, FileStatus } from '../../domain/enums/storage.enums';
import { IStorageProvider } from '../../domain/entities/storage-provider.interface';
import { S3Provider } from '../../infrastructure/providers/s3.provider';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';
import { UploadPolicyService } from './upload-policy.service';
import {
  GenerateUploadUrlRequest,
  GenerateUploadUrlResponse,
  ConfirmUploadRequest,
  ConfirmUploadResponse,
  GenerateDownloadUrlRequest,
  GenerateDownloadUrlResponse,
  DeleteFileRequest,
  FileMetadata,
} from '../../storage.types';

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
    const defaultProviderStr =
      this.configService.get<string>('storage.defaultProvider');
    this.defaultProvider =
      defaultProviderStr === 'AZURE' ? StorageProvider.AZURE : StorageProvider.S3;
  }

  /**
   * Generate a presigned upload URL for a new file.
   */
  async generateUploadUrl(
    request: GenerateUploadUrlRequest,
    planType: 'free' | 'pro' | 'enterprise' = 'free',
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
    const fileId = uuidv4();
    const storageKey = this.generateStorageKey(orgId, fileId);

    // Get presigned URL expiration
    const expirationSeconds =
      this.configService.get<number>('storage.presignedUrl.expirationSeconds') ??
      3600;
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
  async confirmUpload(request: ConfirmUploadRequest): Promise<ConfirmUploadResponse> {
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
      throw new BadRequestException(`File ${fileId} upload session has expired`);
    }

    // Verify file exists in storage
    const provider = this.getProvider(file.provider);
    const exists = await provider.objectExists(file.storageKey);
    if (!exists) {
      throw new BadRequestException(
        `File ${fileId} has not been uploaded to storage`,
      );
    }

    // Mark as confirmed
    const confirmedFile = await this.storageRepository.confirmUpload(fileId);

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
      confirmedAt: confirmedFile.confirmedAt!,
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
      this.configService.get<number>('storage.presignedUrl.expirationSeconds') ??
      3600;
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
}
