import { StorageProvider } from '@prisma/client';

export class FileDeletedEvent {
  readonly eventType = 'file.deleted';
  readonly timestamp: Date;

  fileId!: string;
  orgId!: string;
  userId!: string;
  storageKey!: string;
  storageProvider!: StorageProvider;

  constructor(data: Omit<FileDeletedEvent, 'eventType' | 'timestamp'>) {
    this.timestamp = new Date();
    Object.assign(this, data);
  }
}
