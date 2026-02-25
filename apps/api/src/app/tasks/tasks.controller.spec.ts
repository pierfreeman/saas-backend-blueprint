import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTaskDto } from './dto/create-task.dto';

const dto: CreateTaskDto = { name: 'job', data: { x: 1 } };

describe('TasksController', () => {
  let controller: TasksController;
  let tasksService: jest.Mocked<TasksService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: { createHeavyJob: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TasksController);
    tasksService = module.get(TasksService) as jest.Mocked<TasksService>;
  });

  describe('createHeavyJob', () => {
    it('returns accepted response with jobId', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_123' });
      const result = await controller.createHeavyJob(dto, 'org-1');
      expect(result).toMatchObject({
        jobId: 'job_123',
        status: 'accepted',
        message: 'Job submitted for processing',
      });
      expect(result.timestamp).toBeDefined();
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith('org-1', dto);
    });

    it('uses "default" as tenantId when @CurrentTenant returns undefined', async () => {
      tasksService.createHeavyJob.mockResolvedValue({ jobId: 'job_456' });
      await controller.createHeavyJob(dto, undefined);
      expect(tasksService.createHeavyJob).toHaveBeenCalledWith('default', dto);
    });

    it('propagates service errors', async () => {
      tasksService.createHeavyJob.mockRejectedValue(new Error('queue full'));
      await expect(controller.createHeavyJob(dto, 'org-1')).rejects.toThrow(
        'queue full',
      );
    });
  });
});
