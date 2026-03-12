import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UploadPolicyService } from './upload-policy.service';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';

describe('UploadPolicyService', () => {
  let service: UploadPolicyService;
  let configService: jest.Mocked<ConfigService>;
  let storageRepository: jest.Mocked<StorageRepository>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    storageRepository = {
      getStorageUsage: jest.fn(),
    } as unknown as jest.Mocked<StorageRepository>;

    // Mock storage quotas config
    configService.get.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        'storage.quotas': {
          freePlan: {
            storageLimitGb: 1,
            fileCountLimit: 100,
            maxFileSizeGb: 0.1,
          },
          proPlan: {
            storageLimitGb: 50,
            fileCountLimit: 10000,
            maxFileSizeGb: 20,
          },
          enterprisePlan: {
            storageLimitGb: undefined,
            fileCountLimit: undefined,
            maxFileSizeGb: 100,
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
    it('should return free plan policy', () => {
      const policy = service.getUploadPolicy('free');
      expect(policy.maxFileSizeBytes).toBe(0.1 * 1024 * 1024 * 1024); // 100MB
    });

    it('should return pro plan policy', () => {
      const policy = service.getUploadPolicy('pro');
      expect(policy.maxFileSizeBytes).toBe(20 * 1024 * 1024 * 1024); // 20GB
    });

    it('should return enterprise plan policy', () => {
      const policy = service.getUploadPolicy('enterprise');
      expect(policy.maxFileSizeBytes).toBe(100 * 1024 * 1024 * 1024); // 100GB
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
          50 * 1024 * 1024, // 50MB
          'free',
        ),
      ).resolves.not.toThrow();
    });

    it('should throw BadRequestException for file too large', async () => {
      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          200 * 1024 * 1024, // 200MB (exceeds free plan 100MB limit)
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

    it('should throw ForbiddenException when storage quota exceeded', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(1 * 1024 * 1024 * 1024), // 1GB (at limit)
        fileCount: 50,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          1024 * 1024, // 1MB more would exceed quota
          'free',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow upload for enterprise plan with no limits', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(500 * 1024 * 1024 * 1024), // 500GB
        fileCount: 50000,
      });

      await expect(
        service.validateUploadRequest(
          'org-123',
          'test.pdf',
          'application/pdf',
          50 * 1024 * 1024 * 1024, // 50GB
          'enterprise',
        ),
      ).resolves.not.toThrow();
    });
  });
});
