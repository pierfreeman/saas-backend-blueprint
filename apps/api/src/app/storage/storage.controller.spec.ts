import { Test, TestingModule } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from '@libs/storage';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

// Prevent loading the full @libs/storage module graph (AWS SDK, Prisma, ESM-only deps).
jest.mock('@libs/storage', () => ({
  StorageService: class MockStorageService {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-1';
const USER_ID = 'user-uuid-1';
const FILE_ID = 'file-uuid-1';
const NOW = new Date('2026-03-13T12:00:00Z');

const baseFile = {
  id: FILE_ID,
  orgId: ORG_ID,
  uploadedBy: USER_ID,
  storageKey: 'org/org-uuid-1/file-uuid-1',
  provider: 'S3',
  filename: 'document.pdf',
  size: BigInt(1048576),
  mimeType: 'application/pdf',
  status: 'COMPLETED',
  expiresAt: NOW,
  confirmedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockService = {
  generateUploadUrl: jest.fn(),
  confirmUpload: jest.fn(),
  generateDownloadUrl: jest.fn(),
  getFile: jest.fn(),
  listFiles: jest.fn(),
  deleteFile: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageController', () => {
  let controller: StorageController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [{ provide: StorageService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrgContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RBACGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(StorageController);
  });

  // ── POST /files/upload-url ─────────────────────────────────────────────────

  describe('generateUploadUrl', () => {
    it('returns upload URL and file metadata', async () => {
      const dto: GenerateUploadUrlDto = {
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
      };
      const serviceResponse = {
        fileId: FILE_ID,
        uploadUrl: 'https://s3.example.com/upload?sig=xxx',
        storageKey: 'org/org-uuid-1/file-uuid-1',
        expiresAt: NOW,
      };
      mockService.generateUploadUrl.mockResolvedValue(serviceResponse);

      const result = await controller.generateUploadUrl(dto, ORG_ID, USER_ID);

      expect(result).toEqual({
        fileId: FILE_ID,
        uploadUrl: 'https://s3.example.com/upload?sig=xxx',
        storageKey: 'org/org-uuid-1/file-uuid-1',
        expiresAt: NOW,
      });
      expect(mockService.generateUploadUrl).toHaveBeenCalledWith({
        orgId: ORG_ID,
        userId: USER_ID,
        filename: dto.filename,
        mimeType: dto.mimeType,
        size: dto.size,
      });
    });
  });

  // ── POST /files/confirm ────────────────────────────────────────────────────

  describe('confirmUpload', () => {
    it('returns confirmation response', async () => {
      const dto: ConfirmUploadDto = { fileId: FILE_ID };
      const serviceResponse = {
        fileId: FILE_ID,
        status: 'COMPLETED',
        confirmedAt: NOW,
      };
      mockService.confirmUpload.mockResolvedValue(serviceResponse);

      const result = await controller.confirmUpload(dto, ORG_ID, USER_ID);

      expect(result).toEqual({
        fileId: FILE_ID,
        status: 'COMPLETED',
        confirmedAt: NOW,
      });
      expect(mockService.confirmUpload).toHaveBeenCalledWith({
        fileId: FILE_ID,
        orgId: ORG_ID,
        userId: USER_ID,
      });
    });
  });

  // ── GET /files/:id/download ────────────────────────────────────────────────

  describe('generateDownloadUrl', () => {
    it('returns presigned download URL with file info', async () => {
      mockService.generateDownloadUrl.mockResolvedValue({
        downloadUrl: 'https://s3.example.com/download?sig=yyy',
        expiresAt: NOW,
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: BigInt(1048576),
      });

      const result = await controller.generateDownloadUrl(
        FILE_ID,
        ORG_ID,
        USER_ID,
      );

      expect(result).toEqual({
        downloadUrl: 'https://s3.example.com/download?sig=yyy',
        expiresAt: NOW,
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: '1048576',
      });
      expect(mockService.generateDownloadUrl).toHaveBeenCalledWith({
        fileId: FILE_ID,
        orgId: ORG_ID,
        userId: USER_ID,
      });
    });

    it('serializes null size and mimeType as null', async () => {
      mockService.generateDownloadUrl.mockResolvedValue({
        downloadUrl: 'https://s3.example.com/download?sig=yyy',
        expiresAt: NOW,
        filename: 'document.pdf',
        mimeType: null,
        size: null,
      });

      const result = await controller.generateDownloadUrl(
        FILE_ID,
        ORG_ID,
        USER_ID,
      );

      expect(result.size).toBeNull();
      expect(result.mimeType).toBeNull();
    });
  });

  // ── GET /files/:id ─────────────────────────────────────────────────────────

  describe('getFile', () => {
    it('returns file metadata', async () => {
      mockService.getFile.mockResolvedValue(baseFile);

      const result = await controller.getFile(FILE_ID, ORG_ID);

      expect(result).toEqual({
        id: FILE_ID,
        orgId: ORG_ID,
        uploadedBy: USER_ID,
        storageKey: 'org/org-uuid-1/file-uuid-1',
        provider: 'S3',
        filename: 'document.pdf',
        size: '1048576',
        mimeType: 'application/pdf',
        status: 'COMPLETED',
        expiresAt: NOW,
        confirmedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(mockService.getFile).toHaveBeenCalledWith(FILE_ID, ORG_ID);
    });

    it('serializes null size as null', async () => {
      mockService.getFile.mockResolvedValue({ ...baseFile, size: null });

      const result = await controller.getFile(FILE_ID, ORG_ID);

      expect(result.size).toBeNull();
    });
  });

  // ── GET /files ─────────────────────────────────────────────────────────────

  describe('listFiles', () => {
    it('returns mapped list of file metadata', async () => {
      mockService.listFiles.mockResolvedValue([baseFile]);

      const result = await controller.listFiles(ORG_ID, 20, 0);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: FILE_ID,
        orgId: ORG_ID,
        size: '1048576',
      });
      expect(mockService.listFiles).toHaveBeenCalledWith(ORG_ID, {
        limit: 20,
        offset: 0,
      });
    });

    it('returns empty array when no files exist', async () => {
      mockService.listFiles.mockResolvedValue([]);

      const result = await controller.listFiles(ORG_ID);

      expect(result).toEqual([]);
    });

    it('passes undefined limit and offset when omitted', async () => {
      mockService.listFiles.mockResolvedValue([]);

      await controller.listFiles(ORG_ID);

      expect(mockService.listFiles).toHaveBeenCalledWith(ORG_ID, {
        limit: undefined,
        offset: undefined,
      });
    });
  });

  // ── DELETE /files/:id ──────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('calls service deleteFile and returns void', async () => {
      mockService.deleteFile.mockResolvedValue(undefined);

      const result = await controller.deleteFile(FILE_ID, ORG_ID, USER_ID);

      expect(result).toBeUndefined();
      expect(mockService.deleteFile).toHaveBeenCalledWith({
        fileId: FILE_ID,
        orgId: ORG_ID,
        userId: USER_ID,
      });
    });
  });
});
