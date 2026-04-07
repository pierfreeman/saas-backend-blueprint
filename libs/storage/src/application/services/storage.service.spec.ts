import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import { S3Provider } from '../../infrastructure/providers/s3.provider';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';
import { UploadPolicyService } from './upload-policy.service';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { FileStatus, StorageProvider } from '../../domain/enums/storage.enums';
import { Mock, Mocked, vi } from 'vitest';

describe('StorageService', () => {
  let service: StorageService;
  let configService: Mocked<ConfigService>;
  let s3Provider: Mocked<S3Provider>;
  let storageRepository: Mocked<StorageRepository>;
  let uploadPolicyService: Mocked<UploadPolicyService>;
  let activityLog: Mocked<ActivityLogService>;
  let legalAudit: Mocked<LegalAuditService>;

  beforeEach(async () => {
    configService = {
      get: vi.fn(),
    } as unknown as Mocked<ConfigService>;

    s3Provider = {
      generateUploadUrl: vi.fn(),
      generateDownloadUrl: vi.fn(),
      deleteObject: vi.fn(),
      objectExists: vi.fn(),
      getObjectSize: vi.fn(),
    } as unknown as Mocked<S3Provider>;

    storageRepository = {
      createFile: vi.fn(),
      findByIdAndOrg: vi.fn(),
      confirmUpload: vi.fn(),
      deleteFile: vi.fn(),
      findByOrg: vi.fn(),
      findByPrefix: vi.fn(),
      markExpired: vi.fn(),
      getStorageUsage: vi.fn(),
    } as unknown as Mocked<StorageRepository>;

    uploadPolicyService = {
      validateUploadRequest: vi.fn(),
    } as unknown as Mocked<UploadPolicyService>;

    activityLog = {
      logActivity: vi.fn(),
    } as unknown as Mocked<ActivityLogService>;

    legalAudit = {
      recordEvent: vi.fn(),
    } as unknown as Mocked<LegalAuditService>;

    // Mock config
    configService.get.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        'storage.defaultProvider': 'S3',
        'storage.presignedUrl.expirationSeconds': 3600,
      };
      return config[key];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: configService },
        { provide: S3Provider, useValue: s3Provider },
        { provide: StorageRepository, useValue: storageRepository },
        { provide: UploadPolicyService, useValue: uploadPolicyService },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: LegalAuditService, useValue: legalAudit },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateUploadUrl', () => {
    it('should generate presigned upload URL', async () => {
      const mockRequest = {
        orgId: 'org-123',
        userId: 'user-456',
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
      };

      const mockUploadUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      const mockFileId = 'file-789';

      uploadPolicyService.validateUploadRequest.mockResolvedValue(undefined);
      s3Provider.generateUploadUrl.mockResolvedValue(mockUploadUrl);
      storageRepository.createFile.mockResolvedValue({
        id: mockFileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockFileId}`,
        provider: StorageProvider.S3,
        filename: mockRequest.filename,
        size: null,
        mimeType: mockRequest.mimeType,
        status: FileStatus.PENDING,
        expiresAt: new Date(),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.generateUploadUrl(mockRequest);

      expect(result.uploadUrl).toBe(mockUploadUrl);
      expect(result.fileId).toBeDefined();
      expect(result.storageKey).toContain(mockRequest.orgId);
      expect(uploadPolicyService.validateUploadRequest).toHaveBeenCalled();
      expect(s3Provider.generateUploadUrl).toHaveBeenCalled();
      expect(storageRepository.createFile).toHaveBeenCalled();
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: mockRequest.orgId,
          action: 'file.upload.requested',
        }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'file.upload.requested',
        }),
      );
    });

    it('should throw error if validation fails', async () => {
      const mockRequest = {
        orgId: 'org-123',
        userId: 'user-456',
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
      };

      uploadPolicyService.validateUploadRequest.mockRejectedValue(
        new BadRequestException('File too large'),
      );

      await expect(service.generateUploadUrl(mockRequest)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('confirmUpload', () => {
    it('should confirm file upload', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: null,
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: new Date(Date.now() + 3600000),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockConfirmedFile = {
        ...mockFile,
        status: FileStatus.COMPLETED,
        confirmedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      s3Provider.objectExists.mockResolvedValue(true);
      s3Provider.getObjectSize.mockResolvedValue(BigInt(12582912)); // 12 MB
      storageRepository.confirmUpload.mockResolvedValue(mockConfirmedFile);

      const result = await service.confirmUpload(mockRequest);

      expect(result.fileId).toBe(mockRequest.fileId);
      expect(result.status).toBe(FileStatus.COMPLETED);
      expect(storageRepository.confirmUpload).toHaveBeenCalledWith(
        mockRequest.fileId,
        BigInt(12582912),
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'file.upload.confirmed',
        }),
      );
    });

    it('should throw NotFoundException if file not found', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(null);

      await expect(service.confirmUpload(mockRequest)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException if file not in PENDING state', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: null,
        mimeType: 'application/pdf',
        status: FileStatus.COMPLETED,
        expiresAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);

      await expect(service.confirmUpload(mockRequest)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if file expired', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: null,
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      storageRepository.markExpired.mockResolvedValue(mockFile);

      await expect(service.confirmUpload(mockRequest)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageRepository.markExpired).toHaveBeenCalledWith(
        mockRequest.fileId,
      );
    });

    it('should throw BadRequestException if file not in storage', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: null,
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: new Date(Date.now() + 3600000),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      s3Provider.objectExists.mockResolvedValue(false);

      await expect(service.confirmUpload(mockRequest)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('generateDownloadUrl', () => {
    it('should generate presigned download URL', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1048576),
        mimeType: 'application/pdf',
        status: FileStatus.COMPLETED,
        expiresAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockDownloadUrl =
        'https://s3.amazonaws.com/bucket/key?signature=xyz';

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      s3Provider.generateDownloadUrl.mockResolvedValue(mockDownloadUrl);

      const result = await service.generateDownloadUrl(mockRequest);

      expect(result.downloadUrl).toBe(mockDownloadUrl);
      expect(result.filename).toBe(mockFile.filename);
      expect(result.mimeType).toBe(mockFile.mimeType);
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'file.download.requested',
        }),
      );
    });

    it('should throw NotFoundException if file not found', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(null);

      await expect(service.generateDownloadUrl(mockRequest)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if file not completed', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: null,
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: new Date(),
        confirmedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);

      await expect(service.generateDownloadUrl(mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file from storage and database', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1048576),
        mimeType: 'application/pdf',
        status: FileStatus.COMPLETED,
        expiresAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      s3Provider.deleteObject.mockResolvedValue(undefined);
      storageRepository.deleteFile.mockResolvedValue(undefined);

      await service.deleteFile(mockRequest);

      expect(s3Provider.deleteObject).toHaveBeenCalledWith(mockFile.storageKey);
      expect(storageRepository.deleteFile).toHaveBeenCalledWith(
        mockRequest.fileId,
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'file.deleted',
        }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'file.deleted',
        }),
      );
    });

    it('should delete metadata even if storage deletion fails', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      const mockFile = {
        id: mockRequest.fileId,
        orgId: mockRequest.orgId,
        uploadedBy: mockRequest.userId,
        storageKey: `org/${mockRequest.orgId}/${mockRequest.fileId}`,
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1048576),
        mimeType: 'application/pdf',
        status: FileStatus.COMPLETED,
        expiresAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);
      s3Provider.deleteObject.mockRejectedValue(new Error('S3 error'));
      storageRepository.deleteFile.mockResolvedValue(undefined);

      await service.deleteFile(mockRequest);

      expect(storageRepository.deleteFile).toHaveBeenCalledWith(
        mockRequest.fileId,
      );
    });

    it('should throw NotFoundException if file not found', async () => {
      const mockRequest = {
        fileId: 'file-123',
        orgId: 'org-456',
        userId: 'user-789',
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(null);

      await expect(service.deleteFile(mockRequest)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getFile', () => {
    it('should return file metadata', async () => {
      const mockFile = {
        id: 'file-123',
        orgId: 'org-456',
        uploadedBy: 'user-789',
        storageKey: 'org/org-456/file-123',
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1048576),
        mimeType: 'application/pdf',
        status: FileStatus.COMPLETED,
        expiresAt: null,
        confirmedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageRepository.findByIdAndOrg.mockResolvedValue(mockFile);

      const result = await service.getFile('file-123', 'org-456');

      expect(result).toEqual(mockFile);
      expect(storageRepository.findByIdAndOrg).toHaveBeenCalledWith(
        'file-123',
        'org-456',
      );
    });

    it('should throw NotFoundException if file not found', async () => {
      storageRepository.findByIdAndOrg.mockResolvedValue(null);

      await expect(service.getFile('file-123', 'org-456')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listFiles', () => {
    it('should list files for organization', async () => {
      const mockFiles = [
        {
          id: 'file-1',
          orgId: 'org-123',
          uploadedBy: 'user-456',
          storageKey: 'org/org-123/file-1',
          provider: StorageProvider.S3,
          filename: 'file1.pdf',
          size: BigInt(1048576),
          mimeType: 'application/pdf',
          status: FileStatus.COMPLETED,
          expiresAt: null,
          confirmedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'file-2',
          orgId: 'org-123',
          uploadedBy: 'user-456',
          storageKey: 'org/org-123/file-2',
          provider: StorageProvider.S3,
          filename: 'file2.pdf',
          size: BigInt(2097152),
          mimeType: 'application/pdf',
          status: FileStatus.COMPLETED,
          expiresAt: null,
          confirmedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      storageRepository.findByOrg.mockResolvedValue(mockFiles);

      const result = await service.listFiles('org-123', {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockFiles);
      expect(storageRepository.findByOrg).toHaveBeenCalledWith('org-123', {
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('deleteFolder', () => {
    const prefix = 'org/org-456';

    const makeFile = (overrides: Record<string, unknown> = {}) => ({
      id: 'file-1',
      orgId: 'org-456',
      uploadedBy: 'user-789',
      storageKey: `${prefix}/file-1`,
      provider: StorageProvider.S3,
      filename: 'test.pdf',
      size: BigInt(1048576),
      mimeType: 'application/pdf',
      status: FileStatus.COMPLETED,
      expiresAt: null,
      confirmedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it('deletes storage objects for COMPLETED files', async () => {
      const file = makeFile();
      storageRepository.findByPrefix.mockResolvedValue([file as any]);
      s3Provider.deleteObject.mockResolvedValue(undefined);

      await service.deleteFolder(prefix);

      expect(storageRepository.findByPrefix).toHaveBeenCalledWith(prefix);
      expect(s3Provider.deleteObject).toHaveBeenCalledWith(file.storageKey);
    });

    it('skips non-COMPLETED files without calling deleteObject', async () => {
      const pendingFile = makeFile({ status: FileStatus.PENDING });
      storageRepository.findByPrefix.mockResolvedValue([pendingFile as any]);

      await service.deleteFolder(prefix);

      expect(s3Provider.deleteObject).not.toHaveBeenCalled();
    });

    it('warns and continues when deleteObject throws for a COMPLETED file', async () => {
      const file = makeFile();
      storageRepository.findByPrefix.mockResolvedValue([file as any]);
      s3Provider.deleteObject.mockRejectedValue(new Error('S3 unavailable'));

      await expect(service.deleteFolder(prefix)).resolves.not.toThrow();
    });

    it('does nothing when no files are found under the prefix', async () => {
      storageRepository.findByPrefix.mockResolvedValue([]);

      await service.deleteFolder(prefix);

      expect(s3Provider.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('getStorageStats', () => {
    it('returns serialized totalBytes and fileCount', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(10485760),
        fileCount: 3,
      });

      const result = await service.getStorageStats('org-1');

      expect(storageRepository.getStorageUsage).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({ totalBytes: '10485760', fileCount: 3 });
    });

    it('returns zero stats when org has no files', async () => {
      storageRepository.getStorageUsage.mockResolvedValue({
        totalBytes: BigInt(0),
        fileCount: 0,
      });

      const result = await service.getStorageStats('org-empty');

      expect(result).toEqual({ totalBytes: '0', fileCount: 0 });
    });
  });
});
