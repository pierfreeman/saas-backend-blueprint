import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';

// Infrastructure
import { S3StorageClient } from './infrastructure/clients/s3.client';
import { S3Provider } from './infrastructure/providers/s3.provider';
import { AzureBlobStorageClient } from './infrastructure/clients/azure-blob.client';
import { AzureBlobProvider } from './infrastructure/providers/azure-blob.provider';
import { StorageRepository } from './infrastructure/repositories/storage.repository';

// Application
import { StorageService } from './application/services/storage.service';
import { UploadPolicyService } from './application/services/upload-policy.service';

@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    ActivityLogModule,
    LegalAuditModule,
  ],
  providers: [
    // Infrastructure — S3
    S3StorageClient,
    S3Provider,
    // Infrastructure — Azure Blob Storage
    AzureBlobStorageClient,
    AzureBlobProvider,
    // Infrastructure — Repository
    StorageRepository,
    // Application
    StorageService,
    UploadPolicyService,
  ],
  exports: [StorageService, UploadPolicyService],
})
export class StorageModule {}
