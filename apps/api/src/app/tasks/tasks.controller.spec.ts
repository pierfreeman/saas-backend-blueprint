import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard } from '@libs/rbac';
import { CreateTaskDto } from './dto/create-task.dto';
import { JobStatus } from '@libs/prisma-business';
import { Mocked, vi } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dto: CreateTaskDto = { name: 'job', data: { x: 1 } };

const TEST_ORG_ID = 'org-1';
const TEST_USER_ID = 'user-1';
const baseJob = {
  id: 'job-uuid-1',
  orgId: TEST_ORG_ID,
  userId: TEST_USER_ID,
  type: 'heavy_job',
  status: JobStatus.DONE,
  payload: {},
  result: { processed: true },
  error: null,
  attempts: 1,
  startedAt: new Date('2026-02-27T10:00:01Z'),
  finishedAt: new Date('2026-02-27T10:00:03Z'),
  createdAt: new Date('2026-02-27T10:00:00Z'),
  updatedAt: new Date('2026-02-27T10:00:03Z'),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TasksController', () => {
  let controller: TasksController;
  let tasksService: Mocked<TasksService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: {
            createHeavyJob: vi.fn(),
            findJobById: vi.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrgContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RBACGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TasksController);
    tasksService = module.get(TasksService) as Mocked<TasksService>;
  });

  // ── POST /tasks/heavy-job ──────────────────────────────────────────────────

  describe('createHeavyJob', () => {
    it('returns accepted response with jobId', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_123' });
      const result = await controller.createHeavyJob(
        dto,
        TEST_ORG_ID,
        TEST_USER_ID,
      );
      expect(result).toMatchObject({
        jobId: 'job_123',
        status: 'PENDING',
        message: 'Job submitted for processing',
      });
      expect(result.timestamp).toBeDefined();
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith(
        TEST_ORG_ID,
        dto,
        TEST_USER_ID,
      );
    });

    it('passes undefined userId when tenant context is empty', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_456' });
      await controller.createHeavyJob(dto, TEST_ORG_ID, undefined);
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith(
        TEST_ORG_ID,
        dto,
        undefined,
      );
    });

    it('propagates service errors', async () => {
      tasksService.createHeavyJob.mockRejectedValue(new Error('queue full'));
      await expect(
        controller.createHeavyJob(dto, TEST_ORG_ID, TEST_USER_ID),
      ).rejects.toThrow('queue full');
    });
  });

  // ── GET /tasks/:jobId ──────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('returns a JobStatusDto mapped from the Prisma Job', async () => {
      tasksService.findJobById.mockResolvedValue(baseJob as any);

      const result = await controller.getJobStatus('job-uuid-1', TEST_ORG_ID);

      expect(result).toMatchObject({
        jobId: 'job-uuid-1',
        status: JobStatus.DONE,
        type: 'heavy_job',
        result: { processed: true },
        attempts: 1,
      });
      expect(result.error).toBeUndefined();
      expect(tasksService.findJobById).toHaveBeenCalledWith(
        'job-uuid-1',
        TEST_ORG_ID,
      );
    });

    it('propagates NotFoundException from the service', async () => {
      tasksService.findJobById.mockRejectedValue(
        new NotFoundException('Job job-uuid-1 not found'),
      );

      await expect(
        controller.getJobStatus('job-uuid-1', TEST_ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps null error to undefined in the DTO', async () => {
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        error: null,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', TEST_ORG_ID);
      expect(result.error).toBeUndefined();
    });

    it('maps null result to undefined in the DTO', async () => {
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        result: null,
        status: JobStatus.PROCESSING,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', TEST_ORG_ID);
      expect(result.result).toBeUndefined();
    });

    it('includes finishedAt when the job has completed', async () => {
      const finishedAt = new Date('2026-02-27T10:00:05Z');
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        finishedAt,
        status: JobStatus.DONE,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', TEST_ORG_ID);
      expect(result.finishedAt).toEqual(finishedAt);
    });

    it('maps non-null error string to the DTO', async () => {
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        error: 'processing error',
        status: JobStatus.FAILED,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', TEST_ORG_ID);
      expect(result.error).toBe('processing error');
    });
  });
});
