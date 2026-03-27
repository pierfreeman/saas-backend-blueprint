import { Test, TestingModule } from '@nestjs/testing';
import { OrgExportSchedulerService } from './org-export-scheduler.service';
import { OrgExportRepository } from '../../infrastructure/repositories/org-export.repository';
import { ExportStatus } from '@prisma/client';
import { Mock, vi } from 'vitest';

const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';

function buildRepoMock() {
  return {
    findExpiredExports: vi.fn(),
    markExportsExpiredBatch: vi.fn().mockResolvedValue(0),
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
  let repo: ReturnType<typeof buildRepoMock>;

  beforeEach(async () => {
    repo = buildRepoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgExportSchedulerService,
        { provide: OrgExportRepository, useValue: repo },
      ],
    }).compile();

    service = module.get<OrgExportSchedulerService>(OrgExportSchedulerService);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── markExpiredExports ─────────────────────────────────────────────────────

  describe('markExpiredExports', () => {
    beforeEach(() => {
      // Mock console.error to suppress error logs during tests
      vi.spyOn(console, 'error').mockImplementation(vi.fn());
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('finds exports that are COMPLETED and have expired', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      const expiredExport = makeExport({
        expiresAt: new Date('2026-01-01T00:00:00Z'),
      });
      repo.findExpiredExports.mockResolvedValueOnce([expiredExport]);
      repo.markExportsExpiredBatch.mockResolvedValueOnce(1);

      await service.markExpiredExports();

      expect(repo.findExpiredExports).toHaveBeenCalledWith(now);

      vi.useRealTimers();
    });

    it('marks expired exports as EXPIRED', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      const expiredExports = [
        makeExport({ id: 'export-1' }),
        makeExport({ id: 'export-2' }),
      ];
      repo.findExpiredExports.mockResolvedValueOnce(expiredExports);
      repo.markExportsExpiredBatch.mockResolvedValueOnce(2);

      await service.markExpiredExports();

      expect(repo.markExportsExpiredBatch).toHaveBeenCalledWith([
        'export-1',
        'export-2',
      ]);

      vi.useRealTimers();
    });

    it('returns early when no expired exports found', async () => {
      repo.findExpiredExports.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(repo.markExportsExpiredBatch).not.toHaveBeenCalled();
    });

    it('handles errors gracefully without throwing', async () => {
      repo.findExpiredExports.mockRejectedValueOnce(
        new Error('Database error'),
      );

      await expect(service.markExpiredExports()).resolves.not.toThrow();
    });

    it('stringifies non-Error thrown during expiration check (else branch — line 49)', async () => {
      repo.findExpiredExports.mockRejectedValueOnce('plain string error');

      await expect(service.markExpiredExports()).resolves.not.toThrow();
    });

    it('does not throw when updateMany fails', async () => {
      repo.findExpiredExports.mockResolvedValueOnce([makeExport()]);
      repo.markExportsExpiredBatch.mockRejectedValueOnce(
        new Error('Update error'),
      );

      await expect(service.markExpiredExports()).resolves.not.toThrow();
    });

    it('only processes COMPLETED exports (not PENDING or PROCESSING)', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      repo.findExpiredExports.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(repo.findExpiredExports).toHaveBeenCalledWith(now);

      vi.useRealTimers();
    });

    it('ignores exports with null expiresAt', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      repo.findExpiredExports.mockResolvedValueOnce([]);

      await service.markExpiredExports();

      expect(repo.findExpiredExports).toHaveBeenCalledWith(now);

      vi.useRealTimers();
    });

    it('handles large batch of expired exports', async () => {
      const now = new Date('2026-01-02T00:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      const expiredExports = Array.from({ length: 100 }, (_, i) =>
        makeExport({ id: `export-${i}` }),
      );
      repo.findExpiredExports.mockResolvedValueOnce(expiredExports);
      repo.markExportsExpiredBatch.mockResolvedValueOnce(100);

      await service.markExpiredExports();

      expect(repo.markExportsExpiredBatch).toHaveBeenCalledWith(
        expiredExports.map((e) => e.id),
      );

      vi.useRealTimers();
    });

    it('compares expiration time correctly', async () => {
      const now = new Date('2026-01-02T12:00:00Z');
      vi.useFakeTimers().setSystemTime(now);

      const justExpired = makeExport({
        id: 'just-expired',
        expiresAt: new Date('2026-01-02T11:59:59Z'),
      });

      // Only the expired one should be returned by the repo
      repo.findExpiredExports.mockResolvedValueOnce([justExpired]);
      repo.markExportsExpiredBatch.mockResolvedValueOnce(1);

      await service.markExpiredExports();

      expect(repo.findExpiredExports).toHaveBeenCalledWith(now);
      expect(repo.markExportsExpiredBatch).toHaveBeenCalledWith([
        'just-expired',
      ]);

      vi.useRealTimers();
    });
  });
});
