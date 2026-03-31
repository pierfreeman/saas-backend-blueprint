import { Test, TestingModule } from '@nestjs/testing';
import { JobService } from './job.service';
import { JobRepository } from '../../infrastructure/repositories/job.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRepo = {
  create: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  findByIdAndOrg: vi.fn(),
  markProcessing: vi.fn().mockResolvedValue(undefined),
  markDone: vi.fn().mockResolvedValue(undefined),
  markFailed: vi.fn().mockResolvedValue(undefined),
};

const mockActivityLog = {
  logActivity: vi.fn(),
} as unknown as ActivityLogService;

const mockLegalAudit = {
  recordEvent: vi.fn(),
} as unknown as LegalAuditService;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobService', () => {
  let service: JobService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobService,
        { provide: JobRepository, useValue: mockRepo },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: LegalAuditService, useValue: mockLegalAudit },
      ],
    }).compile();

    service = module.get(JobService);
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('delegates to repository', async () => {
      await service.create('job-1', 'org-1', 'heavy_job', { x: 1 }, 'user-1');
      expect(mockRepo.create).toHaveBeenCalledWith(
        'job-1',
        'org-1',
        'heavy_job',
        { x: 1 },
        'user-1',
      );
    });

    it('fires activityLog after create', async () => {
      await service.create('job-1', 'org-1', 'heavy_job', {}, 'user-1');
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'job.created',
          orgId: 'org-1',
          entityId: 'job-1',
        }),
      );
    });

    it('fires legalAudit after create', async () => {
      await service.create('job-1', 'org-1', 'heavy_job', {}, 'user-1');
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'job.created',
          orgId: 'org-1',
        }),
      );
    });

    it('uses "system" as actorId when userId is undefined', async () => {
      await service.create('job-2', 'org-1', 'heavy_job', {});
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'system' }),
      );
    });
  });

  // ── findByIdAndOrg ────────────────────────────────────────────────────────

  describe('findByIdAndOrg', () => {
    it('delegates to repository', async () => {
      const job = { id: 'job-1' };
      mockRepo.findByIdAndOrg.mockResolvedValue(job);
      const result = await service.findByIdAndOrg('job-1', 'org-1');
      expect(result).toBe(job);
      expect(mockRepo.findByIdAndOrg).toHaveBeenCalledWith('job-1', 'org-1');
    });
  });

  // ── markDone ─────────────────────────────────────────────────────────────

  describe('markDone', () => {
    it('delegates to repository', async () => {
      await service.markDone('job-1', { result: true });
      expect(mockRepo.markDone).toHaveBeenCalledWith('job-1', { result: true });
    });
  });

  // ── markFailed ────────────────────────────────────────────────────────────

  describe('markFailed', () => {
    it('delegates to repository', async () => {
      await service.markFailed('job-1', 'timeout');
      expect(mockRepo.markFailed).toHaveBeenCalledWith('job-1', 'timeout');
    });
  });
});
