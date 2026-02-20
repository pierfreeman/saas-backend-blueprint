import { StorageProvider, FileEntityType } from '@prisma/client';

export class FileUploadedEvent {
  readonly eventType = 'file.uploaded';
  readonly timestamp: Date;

  fileId!: string;
  orgId!: string;
  userId!: string;
  fileName!: string;
  mimeType!: string;
  sizeBytes!: bigint;
  storageKey!: string;
  storageProvider!: StorageProvider;
  entityType?: FileEntityType;
  entityId?: string;

  constructor(data: Omit<FileUploadedEvent, 'eventType' | 'timestamp' | 'toJSON'>) {
    this.timestamp = new Date();
    Object.assign(this, data);
  }

  toJSON() {
    return {
      ...this,
      sizeBytes: this.sizeBytes.toString(),
    };
  }
}
