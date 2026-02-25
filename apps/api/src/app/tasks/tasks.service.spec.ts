import { TasksService } from './tasks.service';
import { PubSubService } from '@libs/redis';
import { REDIS_EVENTS } from '@libs/common';
import { CreateTaskDto } from './dto/create-task.dto';

const mockPubSub = {
  publish: jest.fn(),
} as unknown as PubSubService;

const validDto: CreateTaskDto = { name: 'test-job', data: { key: 'value' } };

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TasksService(mockPubSub);
  });

  describe('createHeavyJob', () => {
    it('publishes a HeavyJobCreatedEvent to Redis and returns a jobId', async () => {
      mockPubSub.publish = jest.fn().mockResolvedValue(undefined);

      const result = await service.createHeavyJob('org-1', validDto);

      expect(result.jobId).toMatch(/^job_\d+_[a-z0-9]+$/);
      expect(mockPubSub.publish).toHaveBeenCalledTimes(1);
      expect(mockPubSub.publish).toHaveBeenCalledWith(
        REDIS_EVENTS.HEAVY_JOB_CREATED,
        expect.objectContaining({
          tenantId: 'org-1',
          payload: validDto,
          jobId: result.jobId,
        }),
      );
    });

    it('includes createdAt timestamp in the event', async () => {
      mockPubSub.publish = jest.fn().mockResolvedValue(undefined);
      await service.createHeavyJob('org-2', { name: 'job-2' });
      const event = (mockPubSub.publish as jest.Mock).mock.calls[0][1];
      expect(event.createdAt).toBeInstanceOf(Date);
    });

    it('rethrows when publish fails', async () => {
      mockPubSub.publish = jest.fn().mockRejectedValue(new Error('Redis down'));
      await expect(
        service.createHeavyJob('org-1', { name: 'j' }),
      ).rejects.toThrow('Redis down');
    });

    it('generates a unique jobId per invocation', async () => {
      mockPubSub.publish = jest.fn().mockResolvedValue(undefined);
      const r1 = await service.createHeavyJob('org-1', { name: 'j1' });
      const r2 = await service.createHeavyJob('org-1', { name: 'j2' });
      expect(r1.jobId).not.toBe(r2.jobId);
    });
  });
});
