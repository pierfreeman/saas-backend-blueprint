import { WorkerController, HeavyJobPayload } from './worker.controller';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';

/** Builds a typed DomainEvent<HeavyJobPayload> for HEAVY_JOB_CREATED tests. */
const makeEvent = (
  override: Partial<DomainEvent<HeavyJobPayload>> = {},
): DomainEvent<HeavyJobPayload> => ({
  eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
  timestamp: new Date(),
  payload: { jobId: 'job_001', tenantId: 'org-1', data: {} },
  tenantId: 'org-1',
  eventId: 'evt-test-1',
  ...override,
});

describe('WorkerController', () => {
  let controller: WorkerController;

  beforeEach(() => {
    controller = new WorkerController();
  });

  describe('handleHeavyJobCreated', () => {
    it('processes a valid event without throwing', async () => {
      await expect(
        controller.handleHeavyJobCreated(makeEvent()),
      ).resolves.not.toThrow();
    });

    it('handles different tenant IDs correctly', async () => {
      const tenants = ['org-a', 'org-b', 'default'];

      for (const tenantId of tenants) {
        const event = makeEvent({
          tenantId,
          payload: { jobId: `job_${tenantId}`, tenantId, data: {} },
        });
        await expect(
          controller.handleHeavyJobCreated(event),
        ).resolves.not.toThrow();
      }
    });

    it('re-throws errors so SqsConsumerService can handle DLQ logic', async () => {
      // Force simulateComputation to throw by spying on the private method.
      jest
        .spyOn(controller as any, 'simulateComputation')
        .mockRejectedValueOnce(new Error('computation failed'));

      await expect(
        controller.handleHeavyJobCreated(makeEvent()),
      ).rejects.toThrow('computation failed');
    });
  });
});
