import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { EventBusService } from '@libs/events';
import { JobService } from '@libs/jobs';
import { CreateTaskDto } from './dto/create-task.dto';
import { JobStatus } from '@libs/prisma-business';
import { Mock, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────────────

const mockEventBus = {
  publish: vi.fn(),
} as unknown as EventBusService;

const mockJobService = {
  create: vi.fn(),
  delete: vi.fn(),
  findByIdAndOrg: vi.fn(),
} as unknown as JobService;

const validDto: CreateTaskDto = { name: 'test-job', data: { key: 'value' } };

const baseJob = {
  id: 'job-uuid-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'heavy_job',
  status: JobStatus.PENDING,
  payload: {},
  result: null,
  error: null,
  attempts: 0,
  startedAt: null,
  finishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockJobService.create as Mock).mockResolvedValue(undefined);
    (mockJobService.delete as Mock).mockResolvedValue(undefined);
    service = new TasksService(mockEventBus, mockJobService);
  });

  // ── createHeavyJob ──────────────────────────────────────────────────────────
  describe('createHeavyJob', () => {
    it('creates a PENDING job record before publishing the event', async () => {
      mockEventBus.publish = vi.fn().mockResolvedValue('msg-id');

      const result = await service.createHeavyJob('org-1', validDto, 'user-1');

      // jobRepo.create must be called before eventBus.publish
      const createOrder = (mockJobService.create as Mock).mock
        .invocationCallOrder[0];
      const publishOrder = (mockEventBus.publish as Mock).mock
        .invocationCallOrder[0];
      expect(createOrder).toBeLessThan(publishOrder);

      expect(mockJobService.create).toHaveBeenCalledWith(
        result.jobId,
        'org-1',
        'heavy_job',
        validDto,
        'user-1',
      );
    });

    it('publishes a HEAVY_JOB_CREATED event with the correct shape', async () => {
      mockEventBus.publish = vi.fn().mockResolvedValue('msg-id');

      const result = await service.createHeavyJob('org-1', validDto, 'user-1');

      expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'heavy.job.created',
          tenantId: 'org-1',
          userId: 'user-1',
          payload: expect.objectContaining({
            jobId: result.jobId,
            data: validDto,
          }),
        }),
      );
    });

    it('returns a UUID jobId', async () => {
      mockEventBus.publish = vi.fn().mockResolvedValue('msg-id');
      const result = await service.createHeavyJob('org-1', validDto);
      expect(result.jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('includes a valid Date timestamp in the event', async () => {
      mockEventBus.publish = vi.fn().mockResolvedValue('msg-id');
      await service.createHeavyJob('org-2', { name: 'job-2' });
      const event = (mockEventBus.publish as Mock).mock.calls[0][0];
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('deletes the PENDING job and re-throws when publish fails', async () => {
      mockEventBus.publish = vi
        .fn()
        .mockRejectedValue(new Error('SQS unavailable'));

      await expect(
        service.createHeavyJob('org-1', { name: 'j' }),
      ).rejects.toThrow('SQS unavailable');

      expect(mockJobService.delete).toHaveBeenCalledTimes(1);
    });

    it('generates a unique UUID jobId per invocation', async () => {
      mockEventBus.publish = vi.fn().mockResolvedValue('msg-id');
      const r1 = await service.createHeavyJob('org-1', { name: 'j1' });
      const r2 = await service.createHeavyJob('org-1', { name: 'j2' });
      expect(r1.jobId).not.toBe(r2.jobId);
    });
  });

  // ── findJobById ─────────────────────────────────────────────────────────────
  describe('findJobById', () => {
    it('returns the job when found for the given tenant', async () => {
      (mockJobService.findByIdAndOrg as Mock).mockResolvedValue(baseJob);

      const job = await service.findJobById('job-uuid-1', 'org-1');

      expect(job).toBe(baseJob);
      expect(mockJobService.findByIdAndOrg).toHaveBeenCalledWith(
        'job-uuid-1',
        'org-1',
      );
    });

    it('throws NotFoundException when the job does not exist', async () => {
      (mockJobService.findByIdAndOrg as Mock).mockRejectedValue(
        new NotFoundException('Job job-uuid-1 not found'),
      );

      await expect(service.findJobById('unknown-id', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the job belongs to a different tenant (IDOR prevention)', async () => {
      (mockJobService.findByIdAndOrg as Mock).mockRejectedValue(
        new NotFoundException('Job job-uuid-1 not found'),
      );

      await expect(
        service.findJobById('job-uuid-1', 'org-OTHER'),
      ).rejects.toThrow(NotFoundException);

      expect(mockJobService.findByIdAndOrg).toHaveBeenCalledWith(
        'job-uuid-1',
        'org-OTHER',
      );
    });
  });
});
