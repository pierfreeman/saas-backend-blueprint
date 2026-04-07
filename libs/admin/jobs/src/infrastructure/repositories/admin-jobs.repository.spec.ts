import { Test, TestingModule } from '@nestjs/testing';
import { AdminJobsRepository } from './admin-jobs.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { JobStatus } from '@libs/prisma-business';
import { vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeJob = (overrides = {}) => ({
  id: 'job-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'ORG_EXPORT',
  status: JobStatus.DONE,
  payload: { exportType: 'full' },
  result: null,
  error: null,
  attempts: 1,
  startedAt: new Date('2024-01-01T00:00:00Z'),
  finishedAt: new Date('2024-01-01T00:01:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:01:00Z'),
  ...overrides,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  job: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminJobsRepository', () => {
  let repository: AdminJobsRepository;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJobsRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(AdminJobsRepository);
  });

  // ── findByOrg — base cases ────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns paginated jobs with defaults when no filters provided', async () => {
      const job = makeJob();
      mockPrisma.job.findMany.mockResolvedValue([job]);
      mockPrisma.job.count.mockResolvedValue(1);

      const result = await repository.findByOrg('org-1', {});

      expect(result.total).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(50);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'job-1',
        orgId: 'org-1',
        type: 'ORG_EXPORT',
        status: JobStatus.DONE,
      });
    });

    it('passes limit and offset to prisma', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-1', { limit: 10, offset: 20 });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });

    it('caps limit to MAX_LIMIT (200)', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-1', { limit: 999 });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('applies status filter when provided', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-1', { status: JobStatus.FAILED });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: JobStatus.FAILED }),
        }),
      );
    });

    it('applies type filter when provided', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-1', { type: 'ORG_EXPORT' });

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'ORG_EXPORT' }),
        }),
      );
    });

    it('always scopes query to the given orgId', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-42', {});

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-42' }),
        }),
      );
    });

    it('orders by createdAt descending', async () => {
      mockPrisma.job.findMany.mockResolvedValue([]);
      mockPrisma.job.count.mockResolvedValue(0);

      await repository.findByOrg('org-1', {});

      expect(mockPrisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('runs findMany and count in parallel', async () => {
      mockPrisma.job.findMany.mockResolvedValue([makeJob()]);
      mockPrisma.job.count.mockResolvedValue(5);

      const result = await repository.findByOrg('org-1', {});

      expect(mockPrisma.job.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.job.count).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(5);
    });
  });
});
