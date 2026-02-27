import { NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { EventBusService } from '@libs/events';
import { PrismaService } from '@libs/prisma';
import { CreateTaskDto } from './dto/create-task.dto';
import { JobStatus } from '@prisma/client';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockEventBus = {
  publish: jest.fn(),
} as unknown as EventBusService;

const mockPrisma = {
  job: {
    create: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
  },
} as unknown as PrismaService;

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
    jest.clearAllMocks();
    (mockPrisma.job.create as jest.Mock).mockResolvedValue(baseJob);
    (mockPrisma.job.delete as jest.Mock).mockResolvedValue(baseJob);
    service = new TasksService(mockEventBus, mockPrisma);
  });

  // ── createHeavyJob ──────────────────────────────────────────────────────────

  describe('createHeavyJob', () => {
    it('creates a PENDING job record before publishing the event', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');

      const result = await service.createHeavyJob('org-1', validDto, 'user-1');

      // Prisma create must be called before eventBus.publish
      const createOrder = (mockPrisma.job.create as jest.Mock).mock
        .invocationCallOrder[0];
      const publishOrder = (mockEventBus.publish as jest.Mock).mock
        .invocationCallOrder[0];
      expect(createOrder).toBeLessThan(publishOrder);

      expect(mockPrisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: result.jobId,
          orgId: 'org-1',
          userId: 'user-1',
          type: 'heavy_job',
          status: 'PENDING',
          payload: validDto,
        }),
      });
    });

    it('publishes a HEAVY_JOB_CREATED event with the correct shape', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');

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
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');
      const result = await service.createHeavyJob('org-1', validDto);
      expect(result.jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('includes a valid Date timestamp in the event', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');
      await service.createHeavyJob('org-2', { name: 'job-2' });
      const event = (mockEventBus.publish as jest.Mock).mock.calls[0][0];
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('deletes the PENDING job and re-throws when publish fails', async () => {
      mockEventBus.publish = jest
        .fn()
        .mockRejectedValue(new Error('SQS unavailable'));

      await expect(
        service.createHeavyJob('org-1', { name: 'j' }),
      ).rejects.toThrow('SQS unavailable');

      expect(mockPrisma.job.delete).toHaveBeenCalledTimes(1);
    });

    it('generates a unique UUID jobId per invocation', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');
      const r1 = await service.createHeavyJob('org-1', { name: 'j1' });
      const r2 = await service.createHeavyJob('org-1', { name: 'j2' });
      expect(r1.jobId).not.toBe(r2.jobId);
    });
  });

  // ── findJobById ─────────────────────────────────────────────────────────────

  describe('findJobById', () => {
    it('returns the job when found for the given tenant', async () => {
      (mockPrisma.job.findFirst as jest.Mock).mockResolvedValue(baseJob);

      const job = await service.findJobById('job-uuid-1', 'org-1');

      expect(job).toBe(baseJob);
      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-uuid-1', orgId: 'org-1' },
      });
    });

    it('throws NotFoundException when the job does not exist', async () => {
      (mockPrisma.job.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findJobById('unknown-id', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the job belongs to a different tenant (IDOR prevention)', async () => {
      (mockPrisma.job.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findJobById('job-uuid-1', 'org-OTHER'),
      ).rejects.toThrow(NotFoundException);

      // Verify the query scopes by orgId
      expect(mockPrisma.job.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-uuid-1', orgId: 'org-OTHER' },
      });
    });
  });
});
