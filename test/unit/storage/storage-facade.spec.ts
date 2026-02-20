import { Test, TestingModule } from '@nestjs/testing';
import { StorageFacade } from '../../../src/modules/storage/facade/storage.facade';
import { FileMetadataService } from '../../../src/modules/storage/services/file-metadata.service';
import { UploadSessionService } from '../../../src/modules/storage/services/upload-session.service';
import { MultipartUploadService } from '../../../src/modules/storage/services/multipart-upload.service';
import { PresignedUrlService } from '../../../src/modules/storage/services/presigned-url.service';
import { StorageQuotaService } from '../../../src/modules/storage/services/storage-quota.service';
import { EventBusService } from '../../../src/events/event-bus.service';
import { AuditService } from '../../../src/modules/audit/audit.service';
import { StorageProvider, FileEntityType } from '@prisma/client';
import { CreateUploadSessionDto } from '../../../src/modules/storage/dto';

describe('StorageFacade', () => {
  let facade: StorageFacade;
  let fileMetadataService: jest.Mocked<FileMetadataService>;
  let uploadSessionService: jest.Mocked<UploadSessionService>;
  let multipartUploadService: jest.Mocked<MultipartUploadService>;
  let presignedUrlService: jest.Mocked<PresignedUrlService>;
  let storageQuotaService: jest.Mocked<StorageQuotaService>;
  let eventBus: jest.Mocked<EventBusService>;
  let auditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageFacade,
        {
          provide: FileMetadataService,
          useValue: {
            createFile: jest.fn(),
            findByIdOrFail: jest.fn(),
            findByOrg: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: UploadSessionService,
          useValue: {
            createSession: jest.fn(),
            updateUploadProviderId: jest.fn(),
            validateSession: jest.fn(),
            findByIdOrFail: jest.fn(),
            completeSession: jest.fn(),
            abortSession: jest.fn(),
          },
        },
        {
          provide: MultipartUploadService,
          useValue: {
            initializeMultipartUpload: jest.fn(),
            generatePresignedPartUrl: jest.fn(),
            completeMultipartUpload: jest.fn(),
            abortMultipartUpload: jest.fn(),
            calculatePartSize: jest.fn(),
          },
        },
        {
          provide: PresignedUrlService,
          useValue: {
            generateDownloadUrl: jest.fn(),
          },
        },
        {
          provide: StorageQuotaService,
          useValue: {
            validateUploadAllowed: jest.fn(),
            getQuotaUsage: jest.fn(),
          },
        },
        {
          provide: EventBusService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            logEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    facade = module.get<StorageFacade>(StorageFacade);
    fileMetadataService = module.get(FileMetadataService);
    uploadSessionService = module.get(UploadSessionService);
    multipartUploadService = module.get(MultipartUploadService);
    presignedUrlService = module.get(PresignedUrlService);
    storageQuotaService = module.get(StorageQuotaService);
    eventBus = module.get(EventBusService);
    auditService = module.get(AuditService);
  });

  describe('createUploadSession', () => {
    it('should create upload session and initialize multipart upload', async () => {
      const dto: CreateUploadSessionDto = {
        fileName: 'test.mp4',
        mimeType: 'video/mp4',
        expectedSize: 1024 * 1024 * 100, // 100MB
        storageProvider: StorageProvider.S3,
      };

      const orgId = 'org-123';
      const userId = 'user-456';

      const mockSession = {
        id: 'session-789',
        orgId,
        userId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        expectedSize: BigInt(dto.expectedSize),
        storageProvider: dto.storageProvider,
        uploadProviderId: null,
        status: 'INITIATED',
        expectedParts: null,
        uploadedParts: 0,
        metadata: null,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storageQuotaService.validateUploadAllowed.mockResolvedValue(undefined);
      uploadSessionService.createSession.mockResolvedValue(mockSession as any);
      multipartUploadService.calculatePartSize.mockReturnValue({
        partSize: 5 * 1024 * 1024,
        partCount: 20,
      });
      multipartUploadService.initializeMultipartUpload.mockResolvedValue('upload-id-123');
      uploadSessionService.updateUploadProviderId.mockResolvedValue(mockSession as any);

      const result = await facade.createUploadSession(dto, orgId, userId);

      expect(storageQuotaService.validateUploadAllowed).toHaveBeenCalledWith(
        orgId,
        dto.expectedSize,
      );
      expect(uploadSessionService.createSession).toHaveBeenCalled();
      expect(multipartUploadService.initializeMultipartUpload).toHaveBeenCalled();
      expect(uploadSessionService.updateUploadProviderId).toHaveBeenCalledWith(
        'session-789',
        'upload-id-123',
      );
      expect(eventBus.emit).toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalledWith(
        'FILE_UPLOAD_SESSION_CREATED',
        orgId,
        userId,
        expect.any(Object),
      );
      expect(result.session).toBeDefined();
      expect(result.uploadConfig).toBeDefined();
    });

    it('should throw error if quota exceeded', async () => {
      const dto: CreateUploadSessionDto = {
        fileName: 'huge-file.mp4',
        mimeType: 'video/mp4',
        expectedSize: 1024 * 1024 * 1024 * 100, // 100GB
        storageProvider: StorageProvider.S3,
      };

      storageQuotaService.validateUploadAllowed.mockRejectedValue(new Error('Quota exceeded'));

      await expect(facade.createUploadSession(dto, 'org-123', 'user-456')).rejects.toThrow(
        'Quota exceeded',
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should generate download URL and log audit', async () => {
      const fileId = 'file-123';
      const orgId = 'org-123';
      const userId = 'user-456';

      const mockFile = {
        id: fileId,
        orgId,
        fileName: 'test.mp4',
        storageKey: 'org-123/test.mp4',
      };

      const mockUrl = {
        url: 'https://s3.amazonaws.com/presigned-url',
        expiresIn: 3600,
      };

      fileMetadataService.findByIdOrFail.mockResolvedValue(mockFile as any);
      presignedUrlService.generateDownloadUrl.mockResolvedValue(mockUrl);

      const result = await facade.getDownloadUrl(fileId, orgId, userId);

      expect(fileMetadataService.findByIdOrFail).toHaveBeenCalledWith(fileId);
      expect(presignedUrlService.generateDownloadUrl).toHaveBeenCalledWith(fileId);
      expect(auditService.logEvent).toHaveBeenCalledWith(
        'FILE_DOWNLOAD_URL_GENERATED',
        orgId,
        userId,
        expect.any(Object),
      );
      expect(result.url).toBe(mockUrl.url);
    });
  });
});
