import { Test, TestingModule } from '@nestjs/testing';
import { OrgExportSchedulerService } from './org-export-scheduler.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ExportStatus } from '@prisma/client';

const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';

function buildPrismaMock() {
  return {
    orgExport: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

function makeExport(overrides = {}) {
  return {
    id: EXPORT_UUID,
    orgId: ORG_UUID,
    status: ExportStatus.COMPLETED,
    expiresAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2025-12-31T00:00:00Z'),
    ...overrides,
  };
}

describe('OrgExportSchedulerService', () => {
  let service: OrgExportSchedulerService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgExportSchedulerService,
        { provide: PrismaBusinessService, useValue: prisma },
      ],
    }).compile();

    service = module.get<OrgExportSchedulerService>(OrgExportSchedulerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── markExpiredExports ─────────────────────────────────────────────────────

  describe('markExpiredExports', () => {
    beforeEach(() => {
      // Mock console.error to suppress error logs during tests
      jest.spyOn(console, 'error').mockImplementation(jest.fn());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('finds exports that are COMPLETED and have expired', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      const expiredExport = makeExport({
        expiresAt: new Date('2026-01-01T00:00:00Z'),
      });
      prisma.orgExport.findMany.mockResolvedValueOnce([expiredExport]);
      prisma.orgExport.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.markExpiredExports();

      expect(prisma.orgExport.findMany).toHaveBeenCalledWith({
        where: {
          status: ExportStatus.COMPLETED,
          expiresAt: {
            not: null,
            lt: now,
          },
        },
        select: {
          id: true,
          orgId: true,
          expiresAt: true,
        },
      });

      jest.useRealTimers();
    });

    it('marks expired exports as EXPIRED', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      const expiredExports = [
        makeExport({ id: 'export-1' }),
        makeExport({ id: 'export-2' }),
      ];
      prisma.orgExport.findMany.mockResolvedValueOnce(expiredExports);
      prisma.orgExport.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.markExpiredExports();

      expect(prisma.orgExport.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ['export-1', 'export-2'],
          },
        },
        data: {
          status: ExportStatus.EXPIRED,
        },
      });

      jest.useRealTimers();
    });

    it('returns early when no expired exports found', async () => {
      prisma.orgExport.findMany.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(prisma.orgExport.updateMany).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without throwing', async () => {
      prisma.orgExport.findMany.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(service.markExpiredExports()).resolves.not.toThrow();
    });

    it('does not throw when updateMany fails', async () => {
      prisma.orgExport.findMany.mockResolvedValueOnce([makeExport()]);
      prisma.orgExport.updateMany.mockRejectedValueOnce(
        new Error('Update error'),
      );

      await expect(service.markExpiredExports()).resolves.not.toThrow();
    });

    it('only processes COMPLETED exports (not PENDING or PROCESSING)', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      // Mock with empty array to avoid undefined error
      prisma.orgExport.findMany.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(prisma.orgExport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: ExportStatus.COMPLETED,
          }),
        }),
      );

      jest.useRealTimers();
    });

    it('ignores exports with null expiresAt', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      // Mock with empty array to avoid undefined error
      prisma.orgExport.findMany.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(prisma.orgExport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiresAt: {
              not: null,
              lt: now,
            },
          }),
        }),
      );

      jest.useRealTimers();
    });

    it('handles large batch of expired exports', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      const expiredExports = Array.from({ length: 100 }, (_, i) =>
        makeExport({ id: `export-${i}` }),
      );
      prisma.orgExport.findMany.mockResolvedValueOnce(expiredExports);
      prisma.orgExport.updateMany.mockResolvedValueOnce({ count: 100 });

      await service.markExpiredExports();

      expect(prisma.orgExport.updateMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: expiredExports.map((e) => e.id),
          },
        },
        data: {
          status: ExportStatus.EXPIRED,
        },
      });

      jest.useRealTimers();
    });

    it('compares expiration time correctly', async () => {
      const now = new Date('2026-01-02T12:00:00Z');
      jest.useFakeTimers().setSystemTime(now);

      const justExpired = makeExport({
        id: 'just-expired',
        expiresAt: new Date('2026-01-02T11:59:59Z'),
      });
      const notYetExpired = makeExport({
        id: 'not-yet',
        expiresAt: new Date('2026-01-02T12:00:01Z'),
      });

      // Only the expired one should be returned by the query
      prisma.orgExport.findMany.mockResolvedValueOnce([justExpired]);
      prisma.orgExport.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.markExpiredExports();

      expect(prisma.orgExport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiresAt: {
              not: null,
              lt: now,
            },
          }),
        }),
      );

      jest.useRealTimers();
    });
  });
});
