import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UploadPolicyService } from './upload-policy.service';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';
import { Mock, Mocked, vi } from 'vitest';

describe('UploadPolicyService', () => {
  let service: UploadPolicyService;
  let configService: Mocked<ConfigService>;
  let storageRepository: Mocked<StorageRepository>;

  beforeEach(async () => {
    configService = {
      get: vi.fn(),
    } as unknown as Mocked<ConfigService>;

    storageRepository = {
      getStorageUsage: vi.fn(),
    } as unknown as Mocked<StorageRepository>;

    // Mock storage quotas config — values mirror the production defaults in storage.config.ts
    configService.get.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        'storage.quotas': {
          freePlan: {
            storageLimitGb: 0.1, // 100 MB
            fileCountLimit: 100,
            maxFileSizeGb: 0.05, // 50 MB
          },
          proPlan: {
            storageLimitGb: 5, // 5 GB
            fileCountLimit: 10000,
            maxFileSizeGb: 2, // 2 GB
          },
          enterprisePlan: {
            storageLimitGb: 50, // 50 GB
            fileCountLimit: undefined,
            maxFileSizeGb: 10, // 10 GB
          },
        },
      };
      return config[key];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadPolicyService,
        { provide: ConfigService, useValue: configService },
        { provide: StorageRepository, useValue: storageRepository },
      ],
    }).compile();

    service = module.get<UploadPolicyService>(UploadPolicyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUploadPolicy', () => {
    it('should return free plan policy with 50 MB max file size', () => {
      const policy = service.getUploadPolicy('free');
      expect(policy.maxFileSizeBytes).toBe(0.05 * 1024 * 1024 * 1024); // 50 MB
    });

    it('should return pro plan policy with 2 GB max file size', () => {
      const policy = service.getUploadPolicy('pro');
      expect(policy.maxFileSizeBytes).toBe(2 * 1024 * 1024 * 1024); // 2 GB
    });

    it('should return enterprise plan policy with 10 GB max file size', () => {
      const policy = service.getUploadPolicy('enterprise');
      expect(policy.maxFileSizeBytes).toBe(10 * 1024 * 1024 * 1024); // 10 GB
    });
  });

  describe('validateUploadRequest', () => {
    beforeEach(() => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });
    });

    it('should pass validation for valid file', async () => {
      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          40 * 1024 * 1024, // 40 MB — under 50 MB free plan max
          'free',
        ),
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException for file too large (free plan: max 50 MB)', async () => {
      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          60 * 1024 * 1024, // 60 MB — exceeds free plan 50 MB max
          'free',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when file count limit reached', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 100, // At limit for free plan
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          1024,
          'free',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when storage quota exceeded (free plan: ~102.4 MiB rounded limit from 0.1 GB)', async () => {
      // storageLimitBytes = Math.round(0.1 * 1024^3) = 107374182 bytes
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(Math.round(0.1 * 1024 * 1024 * 1024)), // at the exact rounded limit
        fileCount: 50,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          1, // even 1 byte more would exceed quota
          'free',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('passes validation exactly at free plan storage boundary (100 MB used, new upload is 0 extra bytes)', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(99 * 1024 * 1024), // 99 MB used
        fileCount: 50,
      });

      // 99 MB used + 1 MB new = 100 MB exactly = at limit (not over)
      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          1 * 1024 * 1024, // 1 MB
          'free',
        ),
      ).resolves.not.toThrow();
    });

    it('should allow upload for enterprise plan within 50 GB limit', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(20 * 1024 * 1024 * 1024), // 20 GB used
        fileCount: 5000,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'large-file.zip',
          'application/zip',
          5 * 1024 * 1024 * 1024, // 5 GB upload — total would be 25 GB, still under 50 GB
          'enterprise',
        ),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when enterprise plan 50 GB limit would be exceeded', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(48 * 1024 * 1024 * 1024), // 48 GB used
        fileCount: 5000,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'large-file.zip',
          'application/zip',
          3 * 1024 * 1024 * 1024, // 3 GB upload — total would be 51 GB, exceeds 50 GB limit
          'enterprise',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should validate upload for pro plan under 5 GB total storage limit', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'video.mp4',
          'video/mp4',
          1 * 1024 * 1024 * 1024, // 1 GB — well under 5 GB pro limit
          'pro',
        ),
      ).resolves.not.toThrow();
    });

    it('should throw ForbiddenException when pro plan 5 GB limit would be exceeded', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(4.5 * 1024 * 1024 * 1024), // 4.5 GB used
        fileCount: 100,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'video.mp4',
          'video/mp4',
          1 * 1024 * 1024 * 1024, // 1 GB upload — total would be 5.5 GB, exceeds 5 GB pro limit
          'pro',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('uses org-specific storage limit override when provided', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });
      const customLimit = BigInt(10 * 1024 * 1024 * 1024); // 10GB org override

      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          1024 * 1024,
          'free',
          customLimit,
        ),
      ).resolves.not.toThrow();
    });

    it('throws BadRequestException when MIME type not in allowedMimeTypes', async () => {
      vi.spyOn(service, 'getUploadPolicy').mockReturnValue({
        maxFileSizeBytes: 100 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg'],
      });
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'document.pdf',
          'application/pdf',
          1024,
          'free',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when MIME type is in forbiddenMimeTypes', async () => {
      vi.spyOn(service, 'getUploadPolicy').mockReturnValue({
        maxFileSizeBytes: 100 * 1024 * 1024,
        forbiddenMimeTypes: ['application/x-msdownload', 'application/x-sh'],
      });
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'script.sh',
          'application/x-sh',
          1024,
          'free',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
