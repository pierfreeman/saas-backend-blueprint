import { Test, TestingModule } from '@nestjs/testing';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { StorageController } from './storage.controller';
import { StorageService, UploadPolicyService } from '@libs/storage';
import { FeatureFlagsService } from '@libs/feature-flags';
import { BillingService } from '@libs/billing';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard } from '@libs/rbac';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

// Prevent loading the full module graphs (AWS SDK, Prisma, Stripe, ESM-only deps).
jest.mock('@libs/storage', () => ({
  StorageService: class MockStorageService {},
  UploadPolicyService: class MockUploadPolicyService {},
}));
jest.mock('@libs/feature-flags', () => ({
  FeatureFlagsService: class MockFeatureFlagsService {},
}));
jest.mock('@libs/billing', () => ({
  BillingService: class MockBillingService {},
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

// ── Mock services ─────────────────────────────────────────────────────────────

const mockService = {
  generateUploadUrl: jest.fn(),
  confirmUpload: jest.fn(),
  generateDownloadUrl: jest.fn(),
  getFile: jest.fn(),
  listFiles: jest.fn(),
  deleteFile: jest.fn(),
};

const mockUploadPolicyService = {
  getStorageQuota: jest.fn(),
};

const mockFeatureFlagsService = {
  getEntitlements: jest.fn(),
};

const mockBillingService = {
  getOrgBillingStatus: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageController', () => {
  let controller: StorageController;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default happy-path mocks for plan resolution
    mockFeatureFlagsService.getEntitlements.mockResolvedValue({ plan: 'FREE' });
    mockBillingService.getOrgBillingStatus.mockResolvedValue({
      planId: null,
      billingStatus: 'INACTIVE',
      storageLimit: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        { provide: StorageService, useValue: mockService },
        { provide: UploadPolicyService, useValue: mockUploadPolicyService },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
        { provide: BillingService, useValue: mockBillingService },
      ],
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
    it('returns upload URL and file metadata (free plan by default)', async () => {
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
      // Controller resolves plan and passes it to the service
      expect(mockService.generateUploadUrl).toHaveBeenCalledWith(
        {
          orgId: ORG_ID,
          userId: USER_ID,
          filename: dto.filename,
          mimeType: dto.mimeType,
          size: dto.size,
        },
        'free', // planType resolved from FREE entitlements
        null, // orgStorageLimit (no per-org override)
      );
    });

    it('passes "pro" planType when entitlements.plan is PRO', async () => {
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'PRO',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_pro',
        billingStatus: 'ACTIVE',
        storageLimit: null,
      });
      mockService.generateUploadUrl.mockResolvedValue({
        fileId: FILE_ID,
        uploadUrl: 'https://s3.example.com/upload',
        storageKey: 'org/org-uuid-1/file-uuid-1',
        expiresAt: NOW,
      });

      await controller.generateUploadUrl(
        { filename: 'f.pdf', mimeType: 'application/pdf', size: 1024 },
        ORG_ID,
        USER_ID,
      );

      expect(mockService.generateUploadUrl).toHaveBeenCalledWith(
        expect.any(Object),
        'pro',
        null,
      );
    });

    it('passes "enterprise" planType when entitlements.plan is ENTERPRISE', async () => {
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'ENTERPRISE',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_enterprise',
        billingStatus: 'ACTIVE',
        storageLimit: null,
      });
      mockService.generateUploadUrl.mockResolvedValue({
        fileId: FILE_ID,
        uploadUrl: 'https://s3.example.com/upload',
        storageKey: 'org/org-uuid-1/file-uuid-1',
        expiresAt: NOW,
      });

      await controller.generateUploadUrl(
        { filename: 'f.pdf', mimeType: 'application/pdf', size: 1024 },
        ORG_ID,
        USER_ID,
      );

      expect(mockService.generateUploadUrl).toHaveBeenCalledWith(
        expect.any(Object),
        'enterprise',
        null,
      );
    });

    it('forwards orgStorageLimit per-org override to the service', async () => {
      const customLimit = BigInt(10 * 1024 * 1024 * 1024); // 10 GB custom cap
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'ENTERPRISE',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_enterprise',
        billingStatus: 'ACTIVE',
        storageLimit: customLimit,
      });
      mockService.generateUploadUrl.mockResolvedValue({
        fileId: FILE_ID,
        uploadUrl: 'https://s3.example.com/upload',
        storageKey: 'org/org-uuid-1/file-uuid-1',
        expiresAt: NOW,
      });

      await controller.generateUploadUrl(
        { filename: 'f.pdf', mimeType: 'application/pdf', size: 1024 },
        ORG_ID,
        USER_ID,
      );

      expect(mockService.generateUploadUrl).toHaveBeenCalledWith(
        expect.any(Object),
        'enterprise',
        customLimit,
      );
    });
  });

  // ── GET /files/quota ──────────────────────────────────────────────────────

  describe('getStorageQuota', () => {
    const quotaServiceResponse = {
      storageLimitBytes: BigInt(5 * 1024 * 1024 * 1024), // 5 GB
      storageUsedBytes: BigInt(1 * 1024 * 1024 * 1024), // 1 GB
      fileCount: 42,
      fileCountLimit: 10000,
      maxFileSizeBytes: BigInt(2 * 1024 * 1024 * 1024), // 2 GB
    };

    it('returns storage quota as a DTO with BigInt fields serialized as strings', async () => {
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'PRO',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_pro',
        billingStatus: 'ACTIVE',
        storageLimit: null,
      });
      mockUploadPolicyService.getStorageQuota.mockResolvedValue(
        quotaServiceResponse,
      );

      const result = await controller.getStorageQuota(ORG_ID);

      expect(result).toEqual({
        storageLimitBytes: '5368709120',
        storageUsedBytes: '1073741824',
        fileCount: 42,
        fileCountLimit: 10000,
        maxFileSizeBytes: '2147483648',
      });
      expect(mockUploadPolicyService.getStorageQuota).toHaveBeenCalledWith(
        ORG_ID,
        'pro',
        null,
      );
    });

    it('serializes null storageLimitBytes (per-org override present) as null', async () => {
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'ENTERPRISE',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_enterprise',
        billingStatus: 'ACTIVE',
        storageLimit: null,
      });
      mockUploadPolicyService.getStorageQuota.mockResolvedValue({
        ...quotaServiceResponse,
        storageLimitBytes: null,
      });

      const result = await controller.getStorageQuota(ORG_ID);

      expect(result.storageLimitBytes).toBeNull();
    });

    it('passes per-org storageLimit override to getStorageQuota', async () => {
      const customLimit = BigInt(20 * 1024 * 1024 * 1024);
      mockFeatureFlagsService.getEntitlements.mockResolvedValue({
        plan: 'ENTERPRISE',
      });
      mockBillingService.getOrgBillingStatus.mockResolvedValue({
        planId: 'price_enterprise',
        billingStatus: 'ACTIVE',
        storageLimit: customLimit,
      });
      mockUploadPolicyService.getStorageQuota.mockResolvedValue(
        quotaServiceResponse,
      );

      await controller.getStorageQuota(ORG_ID);

      expect(mockUploadPolicyService.getStorageQuota).toHaveBeenCalledWith(
        ORG_ID,
        'enterprise',
        customLimit,
      );
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

    it('returns orgId when set on the request', () => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ orgId: ORG_ID }) }),
      };
      expect(factory(undefined, ctx)).toBe(ORG_ID);
    });

    it('returns undefined when orgId is absent from the request', () => {
      const ctx = { switchToHttp: () => ({ getRequest: () => ({}) }) };
      expect(factory(undefined, ctx)).toBeUndefined();
    });
  });
});
