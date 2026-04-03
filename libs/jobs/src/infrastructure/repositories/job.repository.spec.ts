import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { JobRepository } from './job.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { JobStatus } from '@libs/prisma-business';
import { vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  job: {
    create: vi.fn(),
    delete: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobRepository', () => {
  let repository: JobRepository;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(JobRepository);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('calls prisma.job.create with PENDING status', async () => {
      mockPrisma.job.create.mockResolvedValue(undefined);

      await repository.create(
        'job-1',
        'org-1',
        'heavy_job',
        { x: 1 },
        'user-1',
      );

      expect(mockPrisma.job.create).toHaveBeenCalledWith({
        data: {
          id: 'job-1',
          orgId: 'org-1',
          userId: 'user-1',
          type: 'heavy_job',
          status: JobStatus.PENDING,
          payload: { x: 1 },
        },
      });
    });

    it('creates without userId when not provided', async () => {
      mockPrisma.job.create.mockResolvedValue(undefined);

      await repository.create('job-2', 'org-1', 'heavy_job', {});

      expect(mockPrisma.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: undefined }),
        }),
      );
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('calls prisma.job.delete with the job id', async () => {
      mockPrisma.job.delete.mockResolvedValue(undefined);

      await repository.delete('job-1');

      expect(mockPrisma.job.delete).toHaveBeenCalledWith({
        where: { id: 'job-1' },
      });
    });

    it('silently swallows errors on delete failure', async () => {
      mockPrisma.job.delete.mockRejectedValue(new Error('not found'));

      await expect(repository.delete('job-missing')).resolves.toBeUndefined();
    });
  });

  // ── findByIdAndOrg ────────────────────────────────────────────────────────

  describe('findByIdAndOrg', () => {
    it('returns the job when found', async () => {
      const job = { id: 'job-1', orgId: 'org-1' };
      mockPrisma.job.findFirst.mockResolvedValue(job);

      const result = await repository.findByIdAndOrg('job-1', 'org-1');

      expect(result).toBe(job);
      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', orgId: 'org-1' },
      });
    });

    it('throws NotFoundException when job is not found', async () => {
      mockPrisma.job.findFirst.mockResolvedValue(null);

      await expect(
        repository.findByIdAndOrg('job-missing', 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── markProcessing ────────────────────────────────────────────────────────

  describe('markProcessing', () => {
    it('updates status to PROCESSING and increments attempts', async () => {
      mockPrisma.job.update.mockResolvedValue(undefined);

      await repository.markProcessing('job-1');

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.PROCESSING,
          attempts: { increment: 1 },
          startedAt: expect.any(Date),
        }),
      });
    });
  });

  // ── markDone ─────────────────────────────────────────────────────────────

  describe('markDone', () => {
    it('updates status to DONE with result and finishedAt', async () => {
      mockPrisma.job.update.mockResolvedValue(undefined);

      await repository.markDone('job-1', { output: 'ok' });

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.DONE,
          result: { output: 'ok' },
          finishedAt: expect.any(Date),
        }),
      });
    });
  });

  // ── markFailed ────────────────────────────────────────────────────────────

  describe('markFailed', () => {
    it('updates status to FAILED with error and finishedAt', async () => {
      mockPrisma.job.update.mockResolvedValue(undefined);

      await repository.markFailed('job-1', 'timeout error');

      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          error: 'timeout error',
          finishedAt: expect.any(Date),
        }),
      });
    });
  });
});
