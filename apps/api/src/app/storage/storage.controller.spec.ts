import { Test, TestingModule } from '@nestjs/testing';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { StorageController } from './storage.controller';
import { StorageService } from '@libs/storage';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard } from '@libs/rbac';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

// Prevent loading the full @libs/storage module graph (AWS SDK, Prisma, ESM-only deps).
jest.mock('@libs/storage', () => ({
  StorageService: class MockStorageService {},
}));

// ── Decorator test helper ─────────────────────────────────────────────────────

/** Extracts the factory function of a custom param decorator by parameter index.
 *  NestJS v11 stores route-arg metadata on the constructor (not the prototype),
 *  using keys of the form `{hash}__customRouteArgs__:{index}`.
 */
function getDecoratorFactory(
  target: object,
  method: string,
  paramIndex: number,
): (data: unknown, ctx: unknown) => unknown {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    target, // must be the constructor, e.g. StorageController (not .prototype)
    method,
  ) as Record<
    string,
    { index: number; factory?: (d: unknown, c: unknown) => unknown }
  >;
  const entry = Object.values(metadata ?? {}).find(
    (e) => e.index === paramIndex,
  );
  if (!entry?.factory)
    throw new Error(`No factory at param ${paramIndex} of ${method}`);
  return entry.factory;
}

/** Minimal ExecutionContext stub for param decorator tests. */
function makeCtx(user?: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) };
}

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

    it('serializes null size as null in the list', async () => {
      mockService.listFiles.mockResolvedValue([{ ...baseFile, size: null }]);

      const result = await controller.listFiles(ORG_ID);

      expect(result[0].size).toBeNull();
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

  // ── Param decorator factories ──────────────────────────────────────────────
  //
  // `CurrentDbUserId` and `CurrentOrgId` are NestJS custom param decorators.
  // When calling controller methods directly in unit tests the decorator
  // factories are bypassed, so we extract them via Reflect metadata and
  // exercise both branches of the optional-chain (`request.user?.xxx`).

  describe('CurrentDbUserId decorator factory', () => {
    const factory = getDecoratorFactory(
      StorageController,
      'generateUploadUrl',
      2, // third parameter: @CurrentDbUserId() userId
    );

    it('returns dbUserId when request.user is present', () => {
      const ctx = makeCtx({ dbUserId: USER_ID });
      expect(factory(undefined, ctx)).toBe(USER_ID);
    });

    it('returns undefined when request.user is absent', () => {
      const ctx = makeCtx(undefined);
      expect(factory(undefined, ctx)).toBeUndefined();
    });
  });

  describe('CurrentOrgId decorator factory', () => {
    const factory = getDecoratorFactory(
      StorageController,
      'generateUploadUrl',
      1, // second parameter: @CurrentOrgId() orgId
    );

    it('returns orgId when request.user is present', () => {
      const ctx = makeCtx({ orgId: ORG_ID });
      expect(factory(undefined, ctx)).toBe(ORG_ID);
    });

    it('returns undefined when request.user is absent', () => {
      const ctx = makeCtx(undefined);
      expect(factory(undefined, ctx)).toBeUndefined();
    });
  });
});
