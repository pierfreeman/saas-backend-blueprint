import { Test, TestingModule } from '@nestjs/testing';
import { StorageQuotaService } from '../../../src/modules/storage/services/storage-quota.service';
import { FileMetadataService } from '../../../src/modules/storage/services/file-metadata.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { SubscriptionPlan } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';

describe('StorageQuotaService', () => {
  let service: StorageQuotaService;
  let prismaService: {
    subscription: {
      findUnique: jest.Mock;
    };
  };
  let fileMetadataService: {
    getTotalStorageByOrg: jest.Mock;
    getFileCountByOrg: jest.Mock;
  };

  beforeEach(async () => {
    const prismaServiceMock = {
      subscription: {
        findUnique: jest.fn(),
      },
    };

    const fileMetadataServiceMock = {
      getTotalStorageByOrg: jest.fn(),
      getFileCountByOrg: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageQuotaService,
        {
          provide: PrismaService,
          useValue: prismaServiceMock,
        },
        {
          provide: FileMetadataService,
          useValue: fileMetadataServiceMock,
        },
      ],
    }).compile();

    service = module.get<StorageQuotaService>(StorageQuotaService);
    prismaService = prismaServiceMock;
    fileMetadataService = fileMetadataServiceMock;
  });

  describe('validateUploadAllowed', () => {
    it('should allow upload for FREE plan within limits', async () => {
      const orgId = 'org-123';
      const fileSizeBytes = 50 * 1024 * 1024; // 50MB

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.FREE,
      } as any);

      fileMetadataService.getTotalStorageByOrg.mockResolvedValue(BigInt(100 * 1024 * 1024)); // 100MB used
      fileMetadataService.getFileCountByOrg.mockResolvedValue(50); // 50 files

      await expect(service.validateUploadAllowed(orgId, fileSizeBytes)).resolves.not.toThrow();
    });

    it('should reject upload if file size exceeds plan limit', async () => {
      const orgId = 'org-123';
      const fileSizeBytes = 200 * 1024 * 1024; // 200MB (exceeds FREE limit of 100MB)

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.FREE,
      } as any);

      await expect(service.validateUploadAllowed(orgId, fileSizeBytes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject upload if storage quota exceeded', async () => {
      const orgId = 'org-123';
      const fileSizeBytes = 100 * 1024 * 1024; // 100MB

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.FREE,
      } as any);

      // Already at 1GB limit
      fileMetadataService.getTotalStorageByOrg.mockResolvedValue(BigInt(1024 * 1024 * 1024));
      fileMetadataService.getFileCountByOrg.mockResolvedValue(50);

      await expect(service.validateUploadAllowed(orgId, fileSizeBytes)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow unlimited storage for ENTERPRISE plan', async () => {
      const orgId = 'org-123';
      const fileSizeBytes = 50 * 1024 * 1024 * 1024; // 50GB

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.ENTERPRISE,
      } as any);

      fileMetadataService.getTotalStorageByOrg.mockResolvedValue(BigInt(100 * 1024 * 1024 * 1024)); // 100GB already used
      fileMetadataService.getFileCountByOrg.mockResolvedValue(50000);

      await expect(service.validateUploadAllowed(orgId, fileSizeBytes)).resolves.not.toThrow();
    });
  });

  describe('getQuotaUsage', () => {
    it('should return quota usage for FREE plan', async () => {
      const orgId = 'org-123';

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.FREE,
      } as any);

      fileMetadataService.getTotalStorageByOrg.mockResolvedValue(BigInt(500 * 1024 * 1024)); // 500MB
      fileMetadataService.getFileCountByOrg.mockResolvedValue(50);

      const usage = await service.getQuotaUsage(orgId);

      expect(usage.plan).toBe(SubscriptionPlan.FREE);
      expect(usage.fileCount).toBe(50);
      expect(usage.fileCountLimit).toBe(100);
      expect(usage.storagePercentage).toBeGreaterThan(0);
      expect(usage.fileCountPercentage).toBe(50);
    });

    it('should return null limits for ENTERPRISE plan', async () => {
      const orgId = 'org-123';

      prismaService.subscription.findUnique.mockResolvedValue({
        plan: SubscriptionPlan.ENTERPRISE,
      } as any);

      fileMetadataService.getTotalStorageByOrg.mockResolvedValue(BigInt(100 * 1024 * 1024 * 1024));
      fileMetadataService.getFileCountByOrg.mockResolvedValue(50000);

      const usage = await service.getQuotaUsage(orgId);

      expect(usage.plan).toBe(SubscriptionPlan.ENTERPRISE);
      expect(usage.storageLimitBytes).toBeNull();
      expect(usage.fileCountLimit).toBeNull();
      expect(usage.storagePercentage).toBeNull();
      expect(usage.fileCountPercentage).toBeNull();
    });
  });
});
