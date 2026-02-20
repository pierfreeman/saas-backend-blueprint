import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorageProvider, FileEntityType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  FileMetadataService,
  UploadSessionService,
  MultipartUploadService,
  PresignedUrlService,
  StorageQuotaService,
} from '../services';
import { FileEntity } from '../entities/file.entity';
import { UploadSessionEntity } from '../entities/upload-session.entity';
import { CreateUploadSessionDto, CompleteUploadDto } from '../dto';
import { EventBusService } from '../../../events/event-bus.service';
import { AuditService } from '../../audit/audit.service';
import { FileUploadedEvent, FileDeletedEvent, UploadSessionCreatedEvent } from '../events';

/**
 * Storage Facade
 *
 * Main orchestration layer for all storage operations.
 * Coordinates services, audit logging, and event emission.
 */
@Injectable()
export class StorageFacade {
  private readonly logger = new Logger(StorageFacade.name);

  constructor(
    private readonly fileMetadataService: FileMetadataService,
    private readonly uploadSessionService: UploadSessionService,
    private readonly multipartUploadService: MultipartUploadService,
    private readonly presignedUrlService: PresignedUrlService,
    private readonly storageQuotaService: StorageQuotaService,
    private readonly eventBus: EventBusService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create upload session (Step 1)
   */
  async createUploadSession(
    dto: CreateUploadSessionDto,
    orgId: string,
    userId: string,
  ): Promise<{
    session: UploadSessionEntity;
    uploadConfig: {
      uploadId: string;
      storageKey: string;
      bucketOrContainer: string;
      partSize: number;
      partCount: number;
    };
  }> {
    this.logger.log(`Creating upload session for file: ${dto.fileName} by user: ${userId}`);

    // Validate quota
    await this.storageQuotaService.validateUploadAllowed(orgId, dto.expectedSize);

    // Generate storage key
    const storageKey = this.generateStorageKey(orgId, dto.fileName);
    const bucketOrContainer = this.getBucketOrContainer(dto.storageProvider);

    // Calculate part size
    const { partSize, partCount } = this.multipartUploadService.calculatePartSize(dto.expectedSize);

    // Create upload session in DB (without provider upload ID yet)
    const session = await this.uploadSessionService.createSession({
      orgId,
      userId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      expectedSize: BigInt(dto.expectedSize),
      storageProvider: dto.storageProvider,
      uploadProviderId: '', // Will be set after initializing with provider
      expectedParts: partCount,
      metadata: dto.metadata,
    });

    // Initialize multipart upload with provider
    const uploadId = await this.multipartUploadService.initializeMultipartUpload(
      session.id,
      bucketOrContainer,
      storageKey,
    );

    // Update session with provider upload ID
    await this.uploadSessionService.updateUploadProviderId(session.id, uploadId);

    // Emit event
    const event = new UploadSessionCreatedEvent({
      uploadSessionId: session.id,
      orgId,
      userId,
      fileName: dto.fileName,
      expectedSize: BigInt(dto.expectedSize),
      storageProvider: dto.storageProvider,
    });

    this.eventBus.emit({
      eventType: event.eventType,
      timestamp: event.timestamp,
      organizationId: orgId,
      userId,
      payload: event as unknown as Record<string, unknown>,
    });

    // Audit log
    await this.auditService.logEvent('FILE_UPLOAD_SESSION_CREATED', orgId, userId, {
      uploadSessionId: session.id,
      fileName: dto.fileName,
      fileSize: dto.expectedSize,
      storageProvider: dto.storageProvider,
      entityType: dto.entityType,
      entityId: dto.entityId,
    });

    return {
      session,
      uploadConfig: {
        uploadId,
        storageKey,
        bucketOrContainer,
        partSize,
        partCount,
      },
    };
  }

  /**
   * Generate presigned URL for part upload (Step 2)
   */
  async generatePresignedPartUrl(
    sessionId: string,
    partNumber: number,
    orgId: string,
    userId: string,
  ): Promise<{ url: string; partNumber: number }> {
    this.logger.debug(`Generating presigned URL for session: ${sessionId}, part: ${partNumber}`);

    // Validate session belongs to org
    const session = await this.uploadSessionService.validateSession(sessionId);

    if (session.orgId !== orgId) {
      throw new BadRequestException('Upload session does not belong to organization');
    }

    // Get storage key from metadata or generate
    const storageKey = this.generateStorageKey(orgId, session.fileName);
    const bucketOrContainer = this.getBucketOrContainer(session.storageProvider);

    const url = await this.multipartUploadService.generatePresignedPartUrl(
      sessionId,
      bucketOrContainer,
      storageKey,
      partNumber,
    );

    return { url, partNumber };
  }

  /**
   * Complete upload (Step 3)
   */
  async completeUpload(
    sessionId: string,
    dto: CompleteUploadDto,
    orgId: string,
    userId: string,
  ): Promise<FileEntity> {
    this.logger.log(`Completing upload for session: ${sessionId}`);

    // Validate session
    const session = await this.uploadSessionService.validateSession(sessionId);

    if (session.orgId !== orgId) {
      throw new BadRequestException('Upload session does not belong to organization');
    }

    // Complete multipart upload and create file metadata
    const fileId = await this.multipartUploadService.completeMultipartUpload(
      sessionId,
      dto.bucketOrContainer,
      dto.storageKey,
      dto.parts || [],
      dto.checksum,
    );

    const file = await this.fileMetadataService.findByIdOrFail(fileId);

    // Emit event
    const event = new FileUploadedEvent({
      fileId: file.id,
      orgId: file.orgId,
      userId: file.uploadedByUserId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storageKey: file.storageKey,
      storageProvider: file.storageProvider,
      entityType: file.entityType || undefined,
      entityId: file.entityId || undefined,
    });

    this.eventBus.emit({
      eventType: event.eventType,
      timestamp: event.timestamp,
      organizationId: orgId,
      userId,
      payload: event.toJSON() as unknown as Record<string, unknown>,
    });

    // Audit log
    await this.auditService.logEvent('FILE_UPLOADED', orgId, userId, {
      fileId: file.id,
      uploadSessionId: sessionId,
      fileName: file.fileName,
      fileSize: file.sizeBytes.toString(),
      storageProvider: file.storageProvider,
      storageKey: file.storageKey,
    });

    return file;
  }

  /**
   * Abort upload (Step 4)
   */
  async abortUpload(
    sessionId: string,
    orgId: string,
    userId: string,
    reason?: string,
  ): Promise<void> {
    this.logger.log(`Aborting upload session: ${sessionId}`);

    const session = await this.uploadSessionService.findByIdOrFail(sessionId);

    if (session.orgId !== orgId) {
      throw new BadRequestException('Upload session does not belong to organization');
    }

    const storageKey = this.generateStorageKey(orgId, session.fileName);
    const bucketOrContainer = this.getBucketOrContainer(session.storageProvider);

    await this.multipartUploadService.abortMultipartUpload(
      sessionId,
      bucketOrContainer,
      storageKey,
    );

    // Audit log
    await this.auditService.logEvent('FILE_UPLOAD_ABORTED', orgId, userId, {
      uploadSessionId: sessionId,
      fileName: session.fileName,
      reason,
    });
  }

  /**
   * Get download URL for file
   */
  async getDownloadUrl(
    fileId: string,
    orgId: string,
    userId: string,
  ): Promise<{ url: string; expiresIn: number }> {
    this.logger.debug(`Generating download URL for file: ${fileId}`);

    const file = await this.fileMetadataService.findByIdOrFail(fileId);

    if (file.orgId !== orgId) {
      throw new BadRequestException('File does not belong to organization');
    }

    const result = await this.presignedUrlService.generateDownloadUrl(fileId);

    // Audit log
    await this.auditService.logEvent('FILE_DOWNLOAD_URL_GENERATED', orgId, userId, {
      fileId,
      fileName: file.fileName,
    });

    return result;
  }

  /**
   * Delete file
   */
  async deleteFile(fileId: string, orgId: string, userId: string): Promise<void> {
    this.logger.log(`Deleting file: ${fileId}`);

    const file = await this.fileMetadataService.findByIdOrFail(fileId);

    if (file.orgId !== orgId) {
      throw new BadRequestException('File does not belong to organization');
    }

    // Soft delete in DB
    await this.fileMetadataService.softDelete(fileId);

    // Emit event (for async cleanup worker)
    const event = new FileDeletedEvent({
      fileId: file.id,
      orgId: file.orgId,
      userId,
      storageKey: file.storageKey,
      storageProvider: file.storageProvider,
    });

    this.eventBus.emit({
      eventType: event.eventType,
      timestamp: event.timestamp,
      organizationId: orgId,
      userId,
      payload: event as unknown as Record<string, unknown>,
    });

    // Audit log
    await this.auditService.logEvent('FILE_DELETED', orgId, userId, {
      fileId,
      fileName: file.fileName,
      storageKey: file.storageKey,
    });
  }

  /**
   * List files by organization
   */
  async listFiles(
    orgId: string,
    options?: {
      entityType?: FileEntityType;
      entityId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<FileEntity[]> {
    return this.fileMetadataService.findByOrg(orgId, options);
  }

  /**
   * Get file by ID
   */
  async getFile(fileId: string, orgId: string): Promise<FileEntity> {
    const file = await this.fileMetadataService.findByIdOrFail(fileId);

    if (file.orgId !== orgId) {
      throw new BadRequestException('File does not belong to organization');
    }

    return file;
  }

  /**
   * Get quota usage
   */
  async getQuotaUsage(orgId: string) {
    return this.storageQuotaService.getQuotaUsage(orgId);
  }

  /**
   * Generate storage key
   */
  private generateStorageKey(orgId: string, fileName: string): string {
    const timestamp = Date.now();
    const uuid = uuidv4();
    const extension = fileName.split('.').pop();
    return `${orgId}/${timestamp}-${uuid}.${extension}`;
  }

  /**
   * Get bucket or container name from config
   * TODO: Make configurable
   */
  private getBucketOrContainer(provider: StorageProvider): string {
    // This should come from config/environment
    const buckets: Record<StorageProvider, string> = {
      [StorageProvider.S3]: process.env.AWS_S3_BUCKET || 'sports-intelligence-storage',
      [StorageProvider.AZURE]: process.env.AZURE_STORAGE_CONTAINER || 'sports-intelligence-storage',
    };

    return buckets[provider];
  }
}
