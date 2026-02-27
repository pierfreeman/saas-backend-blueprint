import { TasksService } from './tasks.service';
import { EventBusService } from '@libs/events';
import { CreateTaskDto } from './dto/create-task.dto';

const mockEventBus = {
  publish: jest.fn(),
} as unknown as EventBusService;

const validDto: CreateTaskDto = { name: 'test-job', data: { key: 'value' } };

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TasksService(mockEventBus);
  });

  describe('createHeavyJob', () => {
    it('publishes a HEAVY_JOB_CREATED event and returns a jobId', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');

      const result = await service.createHeavyJob('org-1', validDto);

      expect(result.jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(mockEventBus.publish).toHaveBeenCalledTimes(1);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'heavy.job.created',
          tenantId: 'org-1',
          payload: expect.objectContaining({
            jobId: result.jobId,
            data: validDto,
          }),
        }),
      );
    });

    it('includes a valid Date timestamp in the event', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');
      await service.createHeavyJob('org-2', { name: 'job-2' });
      const event = (mockEventBus.publish as jest.Mock).mock.calls[0][0];
      expect(event.timestamp).toBeInstanceOf(Date);
    });

    it('re-throws when publish fails', async () => {
      mockEventBus.publish = jest
        .fn()
        .mockRejectedValue(new Error('SQS unavailable'));
      await expect(
        service.createHeavyJob('org-1', { name: 'j' }),
      ).rejects.toThrow('SQS unavailable');
    });

    it('generates a unique UUID jobId per invocation', async () => {
      mockEventBus.publish = jest.fn().mockResolvedValue('msg-id');
      const r1 = await service.createHeavyJob('org-1', { name: 'j1' });
      const r2 = await service.createHeavyJob('org-1', { name: 'j2' });
      expect(r1.jobId).not.toBe(r2.jobId);
    });
  });
});
