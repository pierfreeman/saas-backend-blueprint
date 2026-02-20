import { StorageProvider } from '@prisma/client';

export class UploadSessionCreatedEvent {
  readonly eventType = 'upload.session.created';
  readonly timestamp: Date;

  uploadSessionId!: string;
  orgId!: string;
  userId!: string;
  fileName!: string;
  expectedSize!: bigint;
  storageProvider!: StorageProvider;

  constructor(data: Omit<UploadSessionCreatedEvent, 'eventType' | 'timestamp' | 'toJSON'>) {
    this.timestamp = new Date();
    Object.assign(this, data);
  }

  toJSON() {
    return {
      ...this,
      expectedSize: this.expectedSize.toString(),
    };
  }
}
