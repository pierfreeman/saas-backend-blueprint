import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { FileStatus, StorageProvider } from '../../domain/enums/storage.enums';
import { FileMetadata } from '../../storage.types';

/**
 * Repository for file metadata persistence.
 * Handles all database operations for the File model.
 */
@Injectable()
export class StorageRepository {
  private readonly logger = new Logger(StorageRepository.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Create a new file metadata record.
   */
  async createFile(data: {
    id: string;
    orgId: string;
    uploadedBy: string;
    storageKey: string;
    provider: StorageProvider;
    filename: string;
    mimeType: string;
    expiresAt: Date;
  }): Promise<FileMetadata> {
    const file = await this.prisma.file.create({
      data: {
        id: data.id,
        orgId: data.orgId,
        uploadedBy: data.uploadedBy,
        storageKey: data.storageKey,
        provider: data.provider,
        filename: data.filename,
        mimeType: data.mimeType,
        status: FileStatus.PENDING,
        expiresAt: data.expiresAt,
      },
    });

    return this.mapToFileMetadata(file);
  }

  /**
   * Find a file by ID.
   */
  async findById(fileId: string): Promise<FileMetadata | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    return file ? this.mapToFileMetadata(file) : null;
  }

  /**
   * Find a file by ID and organization (for tenant isolation).
   */
  async findByIdAndOrg(
    fileId: string,
    orgId: string,
  ): Promise<FileMetadata | null> {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        orgId: orgId,
      },
    });

    return file ? this.mapToFileMetadata(file) : null;
  }

  /**
   * Find files by organization.
   */
  async findByOrg(
    orgId: string,
    options?: {
      status?: FileStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<FileMetadata[]> {
    const files = await this.prisma.file.findMany({
      where: {
        orgId: orgId,
        ...(options?.status && { status: options.status }),
      },
      take: options?.limit,
      skip: options?.offset,
      orderBy: { createdAt: 'desc' },
    });

    return files.map((file) => this.mapToFileMetadata(file));
  }

  /**
   * Confirm a file upload.
   */
  async confirmUpload(fileId: string): Promise<FileMetadata> {
    const file = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: FileStatus.COMPLETED,
        confirmedAt: new Date(),
      },
    });

    return this.mapToFileMetadata(file);
  }

  /**
   * Mark a file as expired.
   */
  async markExpired(fileId: string): Promise<FileMetadata> {
    const file = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: FileStatus.EXPIRED,
      },
    });

    return this.mapToFileMetadata(file);
  }

  /**
   * Mark a file as aborted.
   */
  async markAborted(fileId: string): Promise<FileMetadata> {
    const file = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        status: FileStatus.ABORTED,
      },
    });

    return this.mapToFileMetadata(file);
  }

  /**
   * Delete a file metadata record.
   */
  async deleteFile(fileId: string): Promise<void> {
    await this.prisma.file.delete({
      where: { id: fileId },
    });
  }

  /**
   * Get storage usage for an organization.
   */
  async getStorageUsage(orgId: string): Promise<{
    totalBytes: bigint;
    fileCount: number;
  }> {
    const result = await this.prisma.file.aggregate({
      where: {
        orgId: orgId,
        status: FileStatus.COMPLETED,
      },
      _sum: {
        size: true,
      },
      _count: true,
    });

    return {
      totalBytes: result._sum.size ?? BigInt(0),
      fileCount: result._count,
    };
  }

  /**
   * Find all files whose storageKey starts with the given prefix.
   */
  async findByPrefix(prefix: string): Promise<FileMetadata[]> {
    const files = await this.prisma.file.findMany({
      where: {
        storageKey: { startsWith: prefix },
      },
    });
    return files.map((file) => this.mapToFileMetadata(file));
  }

  /**
   * Find expired pending files.
   */
  async findExpiredPending(before: Date): Promise<FileMetadata[]> {
    const files = await this.prisma.file.findMany({
      where: {
        status: FileStatus.PENDING,
        expiresAt: {
          lt: before,
        },
      },
    });

    return files.map((file) => this.mapToFileMetadata(file));
  }

  /**
   * Map Prisma file model to FileMetadata type.
   */
  private mapToFileMetadata(file: {
    id: string;
    orgId: string;
    uploadedBy: string;
    storageKey: string;
    provider: string;
    filename: string;
    size: bigint | null;
    mimeType: string | null;
    status: string;
    expiresAt: Date | null;
    confirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): FileMetadata {
    return {
      id: file.id,
      orgId: file.orgId,
      uploadedBy: file.uploadedBy,
      storageKey: file.storageKey,
      provider: file.provider as StorageProvider,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
      status: file.status as FileStatus,
      expiresAt: file.expiresAt,
      confirmedAt: file.confirmedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }
}
