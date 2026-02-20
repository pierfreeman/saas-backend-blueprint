import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider } from '@prisma/client';

// Controllers
import { StorageController } from './controllers/storage.controller';

// Facade
import { StorageFacade } from './facade/storage.facade';

// Services
import {
  FileMetadataService,
  UploadSessionService,
  MultipartUploadService,
  PresignedUrlService,
  StorageQuotaService,
} from './services';
import { StorageCleanupService } from './services/storage-cleanup.service';

// Providers
import { S3StorageProvider } from './providers/s3.provider';
import { AzureBlobStorageProvider } from './providers/azure.provider';

// External Dependencies
import { PrismaModule } from '../../prisma/prisma.module';
import { EventsModule } from '../../events/events.module';
import { AuditModule } from '../audit/audit.module';
import { RBACModule } from '../rbac/rbac.module';
import { MembershipsModule } from '../memberships/memberships.module';

/**
 * Storage Module
 *
 * Provides enterprise-ready file storage with:
 * - Multi-provider support (S3, Azure)
 * - Direct upload via presigned URLs
 * - Multipart upload for large files
 * - File metadata persistence
 * - Upload session tracking
 * - Quota enforcement
 * - RBAC integration
 * - Audit logging
 * - Event emission
 */
@Module({
  imports: [ConfigModule, PrismaModule, EventsModule, AuditModule, RBACModule, MembershipsModule],
  controllers: [StorageController],
  providers: [
    // Facade
    StorageFacade,

    // Services
    FileMetadataService,
    UploadSessionService,
    MultipartUploadService,
    PresignedUrlService,
    StorageQuotaService,
    StorageCleanupService,

    // Provider Configuration
    {
      provide: 'S3_STORAGE_PROVIDER',
      useFactory: (configService: ConfigService) => {
        const region = configService.get<string>('AWS_REGION', 'us-east-1');
        const accessKeyId = configService.get<string>('AWS_ACCESS_KEY_ID', '');
        const secretAccessKey = configService.get<string>('AWS_SECRET_ACCESS_KEY', '');
        const endpoint = configService.get<string>('AWS_S3_ENDPOINT');

        if (!accessKeyId || !secretAccessKey) {
          console.warn('AWS S3 credentials not configured');
          return null;
        }

        return new S3StorageProvider({
          region,
          accessKeyId,
          secretAccessKey,
          endpoint,
        });
      },
      inject: [ConfigService],
    },

    {
      provide: 'AZURE_STORAGE_PROVIDER',
      useFactory: (configService: ConfigService) => {
        const accountName = configService.get<string>('AZURE_STORAGE_ACCOUNT', '');
        const accountKey = configService.get<string>('AZURE_STORAGE_KEY', '');
        const endpoint = configService.get<string>('AZURE_STORAGE_ENDPOINT');

        if (!accountName || !accountKey) {
          console.warn('Azure Blob Storage credentials not configured');
          return null;
        }

        return new AzureBlobStorageProvider({
          accountName,
          accountKey,
          endpoint,
        });
      },
      inject: [ConfigService],
    },

    // Provider Registration
    {
      provide: 'STORAGE_PROVIDER_REGISTRATION',
      useFactory: (
        multipartService: MultipartUploadService,
        presignedService: PresignedUrlService,
        s3Provider: S3StorageProvider | null,
        azureProvider: AzureBlobStorageProvider | null,
      ) => {
        // Register S3 provider
        if (s3Provider) {
          multipartService.registerProvider(StorageProvider.S3, s3Provider);
          presignedService.registerProvider(StorageProvider.S3, s3Provider);
          console.log('✅ S3 Storage Provider registered');
        }

        // Register Azure provider
        if (azureProvider) {
          multipartService.registerProvider(StorageProvider.AZURE, azureProvider);
          presignedService.registerProvider(StorageProvider.AZURE, azureProvider);
          console.log('✅ Azure Blob Storage Provider registered');
        }

        return { s3: !!s3Provider, azure: !!azureProvider };
      },
      inject: [
        MultipartUploadService,
        PresignedUrlService,
        'S3_STORAGE_PROVIDER',
        'AZURE_STORAGE_PROVIDER',
      ],
    },
  ],
  exports: [
    StorageFacade,
    FileMetadataService,
    UploadSessionService,
    MultipartUploadService,
    PresignedUrlService,
    StorageQuotaService,
  ],
})
export class StorageModule {}
