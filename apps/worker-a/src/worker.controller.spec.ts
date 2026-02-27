import { WorkerController, HeavyJobPayload } from './worker.controller';
import { PrismaService } from '@libs/prisma';
import { PubSubService } from '@libs/redis';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import { JobStatus } from '@prisma/client';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Builds a typed DomainEvent<HeavyJobPayload> for HEAVY_JOB_CREATED tests. */
const makeEvent = (
  override: Partial<DomainEvent<HeavyJobPayload>> = {},
): DomainEvent<HeavyJobPayload> => ({
  eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
  timestamp: new Date(),
  payload: { jobId: 'job_001', tenantId: 'org-1', userId: 'user-1', data: {} },
  tenantId: 'org-1',
  eventId: 'evt-test-1',
  ...override,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  job: {
    update: jest.fn(),
  },
} as unknown as PrismaService;

const mockPubSub = {
  publish: jest.fn(),
} as unknown as PubSubService;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkerController', () => {
  let controller: WorkerController;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.job.update as jest.Mock).mockResolvedValue({});
    (mockPubSub.publish as jest.Mock).mockResolvedValue(undefined);
    controller = new WorkerController(mockPrisma, mockPubSub);
  });

  describe('handleHeavyJobCreated', () => {
    it('transitions the job PROCESSING → DONE on success', async () => {
      const event = makeEvent();
      await controller.handleHeavyJobCreated(event);

      const calls = (mockPrisma.job.update as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);

      // First update: PROCESSING
      expect(calls[0][0]).toMatchObject({
        where: { id: 'job_001' },
        data: expect.objectContaining({ status: JobStatus.PROCESSING }),
      });

      // Second update: DONE
      expect(calls[1][0]).toMatchObject({
        where: { id: 'job_001' },
        data: expect.objectContaining({ status: JobStatus.DONE }),
      });
    });

    it('publishes a PROCESSING message to Redis before work starts', async () => {
      await controller.handleHeavyJobCreated(makeEvent());

      const firstPublish = (mockPubSub.publish as jest.Mock).mock.calls[0];
      expect(firstPublish[0]).toBe('job:update:org-1');
      expect(firstPublish[1]).toMatchObject({
        jobId: 'job_001',
        status: JobStatus.PROCESSING,
        tenantId: 'org-1',
        userId: 'user-1',
      });
    });

    it('publishes a DONE message to Redis on successful completion', async () => {
      await controller.handleHeavyJobCreated(makeEvent());

      const publishCalls = (mockPubSub.publish as jest.Mock).mock.calls;
      expect(publishCalls).toHaveLength(2);

      const donePublish = publishCalls[1];
      expect(donePublish[0]).toBe('job:update:org-1');
      expect(donePublish[1]).toMatchObject({
        jobId: 'job_001',
        status: JobStatus.DONE,
        tenantId: 'org-1',
      });
      expect(donePublish[1].result).toBeDefined();
    });

    it('transitions the job PROCESSING → FAILED and publishes on doWork error', async () => {
      jest
        .spyOn(controller as any, 'doWork')
        .mockRejectedValueOnce(new Error('computation failed'));

      await expect(
        controller.handleHeavyJobCreated(makeEvent()),
      ).rejects.toThrow('computation failed');

      const calls = (mockPrisma.job.update as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0]).toMatchObject({
        where: { id: 'job_001' },
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          error: 'computation failed',
        }),
      });

      const publishCalls = (mockPubSub.publish as jest.Mock).mock.calls;
      expect(publishCalls[1][1]).toMatchObject({
        status: JobStatus.FAILED,
        error: 'computation failed',
      });
    });

    it('increments the attempts counter on PROCESSING transition', async () => {
      await controller.handleHeavyJobCreated(makeEvent());

      const processingUpdate = (mockPrisma.job.update as jest.Mock).mock
        .calls[0][0];
      expect(processingUpdate.data.attempts).toEqual({ increment: 1 });
    });

    it('includes userId=undefined in publish when payload has no userId', async () => {
      const event = makeEvent({
        payload: { jobId: 'j2', tenantId: 'org-1', data: {} },
      });
      await controller.handleHeavyJobCreated(event);

      const firstPublish = (mockPubSub.publish as jest.Mock).mock.calls[0];
      expect(firstPublish[1].userId).toBeUndefined();
    });

    it('uses the correct channel for each tenant', async () => {
      const event = makeEvent({
        tenantId: 'org-xyz',
        payload: { jobId: 'j3', tenantId: 'org-xyz', data: {} },
      });
      await controller.handleHeavyJobCreated(event);

      const allChannels = (mockPubSub.publish as jest.Mock).mock.calls.map(
        ([ch]) => ch,
      );
      expect(allChannels).toEqual(['job:update:org-xyz', 'job:update:org-xyz']);
    });
  });
});
