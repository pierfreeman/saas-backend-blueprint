import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FileEntity } from '../entities/file.entity';
import { StorageProvider, FileEntityType, FileVisibility, Prisma } from '@prisma/client';

@Injectable()
export class FileMetadataService {
  private readonly logger = new Logger(FileMetadataService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create file metadata record
   */
  async createFile(data: {
    orgId: string;
    uploadedByUserId: string;
    storageProvider: StorageProvider;
    bucketOrContainer: string;
    storageKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: bigint;
    checksum?: string;
    entityType?: FileEntityType;
    entityId?: string;
    visibility?: FileVisibility;
  }): Promise<FileEntity> {
    this.logger.debug(`Creating file metadata: ${data.fileName} for org ${data.orgId}`);

    const file = await this.prisma.file.create({
      data: {
        orgId: data.orgId,
        uploadedByUserId: data.uploadedByUserId,
        storageProvider: data.storageProvider,
        bucketOrContainer: data.bucketOrContainer,
        storageKey: data.storageKey,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        checksum: data.checksum,
        entityType: data.entityType,
        entityId: data.entityId,
        visibility: data.visibility || FileVisibility.PRIVATE,
      },
    });

    return new FileEntity(file);
  }

  /**
   * Find file by ID
   */
  async findById(fileId: string): Promise<FileEntity | null> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId, deletedAt: null },
    });

    return file ? new FileEntity(file) : null;
  }

  /**
   * Find file by ID with error throwing
   */
  async findByIdOrFail(fileId: string): Promise<FileEntity> {
    const file = await this.findById(fileId);
    if (!file) {
      throw new NotFoundException(`File not found: ${fileId}`);
    }
    return file;
  }

  /**
   * Find files by organization
   */
  async findByOrg(
    orgId: string,
    options?: {
      entityType?: FileEntityType;
      entityId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<FileEntity[]> {
    const where: Prisma.FileWhereInput = {
      orgId,
      deletedAt: null,
    };

    if (options?.entityType) {
      where.entityType = options.entityType;
    }

    if (options?.entityId) {
      where.entityId = options.entityId;
    }

    const files = await this.prisma.file.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 100,
      skip: options?.offset || 0,
    });

    return files.map((file) => new FileEntity(file));
  }

  /**
   * Find files by entity
   */
  async findByEntity(
    orgId: string,
    entityType: FileEntityType,
    entityId: string,
  ): Promise<FileEntity[]> {
    const files = await this.prisma.file.findMany({
      where: {
        orgId,
        entityType,
        entityId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    return files.map((file) => new FileEntity(file));
  }

  /**
   * Soft delete file
   */
  async softDelete(fileId: string): Promise<FileEntity> {
    this.logger.debug(`Soft deleting file: ${fileId}`);

    const file = await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    return new FileEntity(file);
  }

  /**
   * Hard delete file (remove from DB)
   */
  async hardDelete(fileId: string): Promise<void> {
    this.logger.debug(`Hard deleting file: ${fileId}`);
    await this.prisma.file.delete({
      where: { id: fileId },
    });
  }

  /**
   * Get total storage used by organization
   */
  async getTotalStorageByOrg(orgId: string): Promise<bigint> {
    const result = await this.prisma.file.aggregate({
      where: {
        orgId,
        deletedAt: null,
      },
      _sum: {
        sizeBytes: true,
      },
    });

    return result._sum.sizeBytes || BigInt(0);
  }

  /**
   * Get file count by organization
   */
  async getFileCountByOrg(orgId: string): Promise<number> {
    return this.prisma.file.count({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  /**
   * Update file metadata
   */
  async updateFile(
    fileId: string,
    data: Partial<{
      fileName: string;
      visibility: FileVisibility;
      entityType: FileEntityType;
      entityId: string;
    }>,
  ): Promise<FileEntity> {
    this.logger.debug(`Updating file metadata: ${fileId}`);

    const file = await this.prisma.file.update({
      where: { id: fileId },
      data,
    });

    return new FileEntity(file);
  }
}
