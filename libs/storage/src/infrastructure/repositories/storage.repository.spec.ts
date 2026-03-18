import { Test, TestingModule } from '@nestjs/testing';
import { PrismaBusinessService } from '@libs/prisma-business';
import { StorageRepository } from './storage.repository';
import { FileStatus, StorageProvider } from '../../domain/enums/storage.enums';

const mockPrisma = {
  file: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    aggregate: jest.fn(),
  },
} as unknown as PrismaBusinessService;

describe('StorageRepository', () => {
  let repository: StorageRepository;

  const mockDate = new Date('2024-01-01T00:00:00.000Z');
  const mockFile = {
    id: 'file-123',
    orgId: 'org-123',
    uploadedBy: 'user-123',
    storageKey: 'org/org-123/file-123',
    provider: StorageProvider.S3,
    filename: 'test.pdf',
    size: BigInt(1024),
    mimeType: 'application/pdf',
    status: FileStatus.PENDING,
    expiresAt: mockDate,
    confirmedAt: null,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<StorageRepository>(StorageRepository);
  });

  describe('createFile', () => {
    it('should create a new file metadata record', async () => {
      mockPrisma.file.create = jest.fn().mockResolvedValue(mockFile);

      const result = await repository.createFile({
        id: 'file-123',
        orgId: 'org-123',
        uploadedBy: 'user-123',
        storageKey: 'org/org-123/file-123',
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        expiresAt: mockDate,
      });

      expect(result).toEqual({
        id: 'file-123',
        orgId: 'org-123',
        uploadedBy: 'user-123',
        storageKey: 'org/org-123/file-123',
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1024),
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: mockDate,
        confirmedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      expect(mockPrisma.file.create).toHaveBeenCalledWith({
        data: {
          id: 'file-123',
          orgId: 'org-123',
          uploadedBy: 'user-123',
          storageKey: 'org/org-123/file-123',
          provider: StorageProvider.S3,
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          status: FileStatus.PENDING,
          expiresAt: mockDate,
        },
      });
    });
  });

  describe('findById', () => {
    it('should find a file by ID', async () => {
      mockPrisma.file.findUnique = jest.fn().mockResolvedValue(mockFile);

      const result = await repository.findById('file-123');

      expect(result).toEqual({
        id: 'file-123',
        orgId: 'org-123',
        uploadedBy: 'user-123',
        storageKey: 'org/org-123/file-123',
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1024),
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: mockDate,
        confirmedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      expect(mockPrisma.file.findUnique).toHaveBeenCalledWith({
        where: { id: 'file-123' },
      });
    });

    it('should return null when file not found', async () => {
      mockPrisma.file.findUnique = jest.fn().mockResolvedValue(null);

      const result = await repository.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByIdAndOrg', () => {
    it('should find a file by ID and organization', async () => {
      mockPrisma.file.findFirst = jest.fn().mockResolvedValue(mockFile);

      const result = await repository.findByIdAndOrg('file-123', 'org-123');

      expect(result).toEqual({
        id: 'file-123',
        orgId: 'org-123',
        uploadedBy: 'user-123',
        storageKey: 'org/org-123/file-123',
        provider: StorageProvider.S3,
        filename: 'test.pdf',
        size: BigInt(1024),
        mimeType: 'application/pdf',
        status: FileStatus.PENDING,
        expiresAt: mockDate,
        confirmedAt: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      expect(mockPrisma.file.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'file-123',
          orgId: 'org-123',
        },
      });
    });

    it('should return null when file not found for organization', async () => {
      mockPrisma.file.findFirst = jest.fn().mockResolvedValue(null);

      const result = await repository.findByIdAndOrg('file-123', 'wrong-org');

      expect(result).toBeNull();
    });
  });

  describe('findByOrg', () => {
    it('should find files by organization', async () => {
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([mockFile]);

      const result = await repository.findByOrg('org-123');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-123');

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-123',
        },
        take: undefined,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should find files by organization with status filter', async () => {
      const completedFile = { ...mockFile, status: FileStatus.COMPLETED };
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([completedFile]);

      const result = await repository.findByOrg('org-123', {
        status: FileStatus.COMPLETED,
      });

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(FileStatus.COMPLETED);

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-123',
          status: FileStatus.COMPLETED,
        },
        take: undefined,
        skip: undefined,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should find files by organization with pagination', async () => {
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([mockFile]);

      const result = await repository.findByOrg('org-123', {
        limit: 10,
        offset: 20,
      });

      expect(result).toHaveLength(1);

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: {
          orgId: 'org-123',
        },
        take: 10,
        skip: 20,
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no files found', async () => {
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([]);

      const result = await repository.findByOrg('org-123');

      expect(result).toEqual([]);
    });
  });

  describe('confirmUpload', () => {
    it('should confirm a file upload', async () => {
      const confirmedFile = {
        ...mockFile,
        status: FileStatus.COMPLETED,
        confirmedAt: mockDate,
      };
      mockPrisma.file.update = jest.fn().mockResolvedValue(confirmedFile);

      const result = await repository.confirmUpload('file-123');

      expect(result.status).toBe(FileStatus.COMPLETED);
      expect(result.confirmedAt).toEqual(mockDate);

      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-123' },
        data: {
          status: FileStatus.COMPLETED,
          confirmedAt: expect.any(Date),
        },
      });
    });
  });

  describe('markExpired', () => {
    it('should mark a file as expired', async () => {
      const expiredFile = { ...mockFile, status: FileStatus.EXPIRED };
      mockPrisma.file.update = jest.fn().mockResolvedValue(expiredFile);

      const result = await repository.markExpired('file-123');

      expect(result.status).toBe(FileStatus.EXPIRED);

      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-123' },
        data: {
          status: FileStatus.EXPIRED,
        },
      });
    });
  });

  describe('markAborted', () => {
    it('should mark a file as aborted', async () => {
      const abortedFile = { ...mockFile, status: FileStatus.ABORTED };
      mockPrisma.file.update = jest.fn().mockResolvedValue(abortedFile);

      const result = await repository.markAborted('file-123');

      expect(result.status).toBe(FileStatus.ABORTED);

      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-123' },
        data: {
          status: FileStatus.ABORTED,
        },
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete a file metadata record', async () => {
      mockPrisma.file.delete = jest.fn().mockResolvedValue(mockFile);

      await repository.deleteFile('file-123');

      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-123' },
      });
    });
  });

  describe('getStorageUsage', () => {
    it('should get storage usage for an organization', async () => {
      mockPrisma.file.aggregate = jest.fn().mockResolvedValue({
        _sum: { size: BigInt(5120) },
        _count: 5,
      });

      const result = await repository.getStorageUsage('org-123');

      expect(result).toEqual({
        totalBytes: BigInt(5120),
        fileCount: 5,
      });

      expect(mockPrisma.file.aggregate).toHaveBeenCalledWith({
        where: {
          orgId: 'org-123',
          status: FileStatus.COMPLETED,
        },
        _sum: {
          size: true,
        },
        _count: true,
      });
    });

    it('should return zero usage when no files exist', async () => {
      mockPrisma.file.aggregate = jest.fn().mockResolvedValue({
        _sum: { size: null },
        _count: 0,
      });

      const result = await repository.getStorageUsage('org-123');

      expect(result).toEqual({
        totalBytes: BigInt(0),
        fileCount: 0,
      });
    });
  });

  describe('findExpiredPending', () => {
    it('should find expired pending files', async () => {
      const cutoffDate = new Date('2024-01-02T00:00:00.000Z');
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([mockFile]);

      const result = await repository.findExpiredPending(cutoffDate);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-123');

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: {
          status: FileStatus.PENDING,
          expiresAt: {
            lt: cutoffDate,
          },
        },
      });
    });

    it('should return empty array when no expired pending files found', async () => {
      const cutoffDate = new Date('2024-01-02T00:00:00.000Z');
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([]);

      const result = await repository.findExpiredPending(cutoffDate);

      expect(result).toEqual([]);
    });
  });

  describe('findByPrefix', () => {
    it('should return files whose storageKey starts with the given prefix', async () => {
      const prefixedFile = { ...mockFile, storageKey: 'org/org-123/file-A' };
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([prefixedFile]);

      const result = await repository.findByPrefix('org/org-123');

      expect(result).toHaveLength(1);
      expect(result[0].storageKey).toBe(prefixedFile.storageKey);
      expect(mockPrisma.file.findMany).toHaveBeenCalledWith({
        where: { storageKey: { startsWith: 'org/org-123' } },
      });
    });

    it('should return an empty array when no files match the prefix', async () => {
      mockPrisma.file.findMany = jest.fn().mockResolvedValue([]);

      const result = await repository.findByPrefix('org/no-such-org');

      expect(result).toEqual([]);
    });
  });
});
