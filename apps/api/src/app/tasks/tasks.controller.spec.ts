import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';
import { JobStatus } from '@prisma/client';
import { Request } from 'express';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dto: CreateTaskDto = { name: 'job', data: { x: 1 } };

const baseJob = {
  id: 'job-uuid-1',
  orgId: 'org-1',
  userId: 'user-1',
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

/** Minimal Express Request stub with a JWT user attached. */
const makeReq = (sub = 'user-1'): Partial<Request> => ({
  user: { sub, email: 'user@test.com' } as any,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TasksController', () => {
  let controller: TasksController;
  let tasksService: jest.Mocked<TasksService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: {
            createHeavyJob: jest.fn(),
            findJobById: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TasksController);
    tasksService = module.get(TasksService) as jest.Mocked<TasksService>;
  });

  // ── POST /tasks/heavy-job ──────────────────────────────────────────────────

  describe('createHeavyJob', () => {
    it('returns accepted response with jobId', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_123' });
      const result = await controller.createHeavyJob(
        dto,
        'org-1',
        makeReq() as Request,
      );
      expect(result).toMatchObject({
        jobId: 'job_123',
        status: 'PENDING',
        message: 'Job submitted for processing',
      });
      expect(result.timestamp).toBeDefined();
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith(
        'org-1',
        dto,
        'user-1',
      );
    });

    it('uses "default" as tenantId when @CurrentTenant returns undefined', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_456' });
      await controller.createHeavyJob(dto, undefined, makeReq() as Request);
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith(
        'default',
        dto,
        'user-1',
      );
    });

    it('passes undefined userId when req.user is absent', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_789' });
      await controller.createHeavyJob(dto, 'org-1', {} as Request);
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith(
        'org-1',
        dto,
        undefined,
      );
    });

    it('propagates service errors', async () => {
      tasksService.createHeavyJob.mockRejectedValue(new Error('queue full'));
      await expect(
        controller.createHeavyJob(dto, 'org-1', makeReq() as Request),
      ).rejects.toThrow('queue full');
    });
  });

  // ── GET /tasks/:jobId ──────────────────────────────────────────────────────

  describe('getJobStatus', () => {
    it('returns a JobStatusDto mapped from the Prisma Job', async () => {
      tasksService.findJobById.mockResolvedValue(baseJob as any);

      const result = await controller.getJobStatus('job-uuid-1', 'org-1');

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
        'org-1',
      );
    });

    it('uses "default" tenantId when @CurrentTenant returns undefined', async () => {
      tasksService.findJobById.mockResolvedValue(baseJob as any);
      await controller.getJobStatus('job-uuid-1', undefined);
      expect(tasksService.findJobById).toHaveBeenCalledWith(
        'job-uuid-1',
        'default',
      );
    });

    it('propagates NotFoundException from the service', async () => {
      tasksService.findJobById.mockRejectedValue(
        new NotFoundException('Job job-uuid-1 not found'),
      );

      await expect(
        controller.getJobStatus('job-uuid-1', 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps null error to undefined in the DTO', async () => {
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        error: null,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', 'org-1');
      expect(result.error).toBeUndefined();
    });

    it('maps null result to undefined in the DTO', async () => {
      tasksService.findJobById.mockResolvedValue({
        ...baseJob,
        result: null,
        status: JobStatus.PROCESSING,
      } as any);
      const result = await controller.getJobStatus('job-uuid-1', 'org-1');
      expect(result.result).toBeUndefined();
    });
  });
});
