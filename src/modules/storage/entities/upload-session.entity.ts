import {
  UploadSession as PrismaUploadSession,
  StorageProvider,
  UploadSessionStatus,
} from '@prisma/client';

export class UploadSessionEntity implements PrismaUploadSession {
  id!: string;
  orgId!: string;
  userId!: string;

  fileName!: string;
  mimeType!: string;
  expectedSize!: bigint;

  storageProvider!: StorageProvider;
  uploadProviderId!: string | null;
  status!: UploadSessionStatus;

  expectedParts!: number | null;
  uploadedParts!: number;

  metadata!: any;

  expiresAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;

  constructor(partial: Partial<UploadSessionEntity>) {
    Object.assign(this, partial);
  }

  toJSON() {
    return {
      ...this,
      expectedSize: this.expectedSize.toString(),
    };
  }
}
