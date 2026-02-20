import {
  File as PrismaFile,
  StorageProvider,
  FileEntityType,
  FileVisibility,
} from '@prisma/client';

export class FileEntity implements PrismaFile {
  id!: string;
  orgId!: string;
  uploadedByUserId!: string;

  storageProvider!: StorageProvider;
  bucketOrContainer!: string;
  storageKey!: string;

  fileName!: string;
  mimeType!: string;
  sizeBytes!: bigint;
  checksum!: string | null;

  entityType!: FileEntityType | null;
  entityId!: string | null;

  visibility!: FileVisibility;

  createdAt!: Date;
  deletedAt!: Date | null;

  constructor(partial: Partial<FileEntity>) {
    Object.assign(this, partial);
  }

  toJSON() {
    return {
      ...this,
      sizeBytes: this.sizeBytes.toString(),
    };
  }
}
