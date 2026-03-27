import { SqsConsumerService } from './sqs-consumer.service';
import { WorkerController, HeavyJobPayload } from './worker.controller';
import { DOMAIN_EVENTS, DomainEvent } from '@libs/events';
import { Mocked, vi } from 'vitest';

// ── AWS SDK mock ─────────────────────────────────────────────────────────────
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(function (this: unknown) {
    return { send: mockSend };
  }),
  ReceiveMessageCommand: vi.fn(function (this: unknown, input: unknown) {
    return { input };
  }),
  DeleteMessageCommand: vi.fn(function (this: unknown, input: unknown) {
    return { input };
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeController(): Mocked<WorkerController> {
  return {
    handleHeavyJobCreated: vi.fn().mockResolvedValue(undefined),
    handleOrgDeletionRequested: vi.fn().mockResolvedValue(undefined),
    handleOrgExportRequested: vi.fn().mockResolvedValue(undefined),
  } as unknown as Mocked<WorkerController>;
}

function makeEvent(
  overrides: Partial<DomainEvent<HeavyJobPayload>> = {},
): DomainEvent<HeavyJobPayload> {
  return {
    eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    payload: { jobId: 'job-1', tenantId: 'org-1', data: {} },
    tenantId: 'org-1',
    eventId: 'evt-1',
    ...overrides,
  };
}

function makeSqsMessage(
  body: unknown,
  receiptHandle = 'rh-1',
  messageId = 'msg-1',
) {
  return {
    Body: JSON.stringify(body),
    ReceiptHandle: receiptHandle,
    MessageId: messageId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('SqsConsumerService', () => {
  let controller: Mocked<WorkerController>;
  let service: SqsConsumerService;

  const QUEUE_URL =
    'http://localstack:4566/000000000000/saas-backend-heavy-jobs';

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['SQS_STANDARD_QUEUE_URL'];
    controller = makeController();
    service = new SqsConsumerService(controller);
  });

  // ── onModuleInit ────────────────────────────────────────────────────────────
  describe('onModuleInit', () => {
    it('warns and does not start polling when SQS_STANDARD_QUEUE_URL is not set', () => {
      service.onModuleInit();
      expect((service as any).running).toBe(false);
    });

    it('starts polling when SQS_STANDARD_QUEUE_URL is set', () => {
      process.env['SQS_STANDARD_QUEUE_URL'] = QUEUE_URL;
      // Create the instance first, then spy on its prototype method
      const svc = new SqsConsumerService(controller);
      const pollSpy = vi.spyOn(svc as any, 'poll').mockResolvedValue(undefined);

      svc.onModuleInit();

      expect((svc as any).running).toBe(true);
      expect(pollSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── onModuleDestroy ─────────────────────────────────────────────────────────
  describe('onModuleDestroy', () => {
    it('sets running to false', () => {
      (service as any).running = true;
      service.onModuleDestroy();
      expect((service as any).running).toBe(false);
    });
  });

  // ── processMessage ──────────────────────────────────────────────────────────
  describe('processMessage', () => {
    beforeEach(() => {
      (service as any).queueUrl = QUEUE_URL;
      mockSend.mockResolvedValue({});
    });

    it('dispatches the event and deletes the message on success', async () => {
      const event = makeEvent();
      const msg = makeSqsMessage(event);

      await (service as any).processMessage(msg);

      expect(controller.handleHeavyJobCreated).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledTimes(1); // DeleteMessageCommand
    });

    it('does NOT delete the message when the handler throws', async () => {
      controller.handleHeavyJobCreated.mockRejectedValueOnce(
        new Error('handler error'),
      );
      const msg = makeSqsMessage(makeEvent());

      await (service as any).processMessage(msg);

      expect(mockSend).not.toHaveBeenCalled(); // no delete
    });

    it('skips silently when Body is missing', async () => {
      await (service as any).processMessage({ ReceiptHandle: 'rh' });
      expect(controller.handleHeavyJobCreated).not.toHaveBeenCalled();
    });

    it('skips and logs when Body is invalid JSON', async () => {
      const msg = {
        Body: '{invalid-json}',
        ReceiptHandle: 'rh',
        MessageId: 'mid',
      };
      await expect((service as any).processMessage(msg)).resolves.not.toThrow();
      expect(controller.handleHeavyJobCreated).not.toHaveBeenCalled();
    });

    it('rehydrates timestamp from string to Date', async () => {
      const event = makeEvent();
      const msg = makeSqsMessage(event);

      await (service as any).processMessage(msg);

      const received: DomainEvent<HeavyJobPayload> =
        controller.handleHeavyJobCreated.mock.calls[0][0];
      expect(received.timestamp).toBeInstanceOf(Date);
    });
  });

  // ── poll ───────────────────────────────────────────────────────────────────
  describe('poll', () => {
    it('processes received messages and exits when running becomes false', async () => {
      (service as any).queueUrl = QUEUE_URL;
      (service as any).running = true;

      const msg = makeSqsMessage(makeEvent());

      // First receive returns one message; delete succeeds; second receive stops the loop
      mockSend
        .mockResolvedValueOnce({ Messages: [msg] }) // ReceiveMessageCommand
        .mockResolvedValueOnce({}) // DeleteMessageCommand
        .mockImplementationOnce(() => {
          (service as any).running = false;
          return Promise.resolve({ Messages: [] }); // second ReceiveMessageCommand → exit loop
        });

      await (service as any).poll();

      expect(controller.handleHeavyJobCreated).toHaveBeenCalledTimes(1);
    });

    it('logs error, sleeps 5 s, then retries after a receive failure', async () => {
      (service as any).queueUrl = QUEUE_URL;
      (service as any).running = true;

      const sleepSpy = vi
        .spyOn(service as any, 'sleep')
        .mockResolvedValue(undefined);

      // First send throws; second send exits the loop
      mockSend
        .mockRejectedValueOnce(new Error('network error'))
        .mockImplementationOnce(() => {
          (service as any).running = false;
          return Promise.resolve({ Messages: [] });
        });

      await (service as any).poll();

      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });
  });

  // ── dispatch ────────────────────────────────────────────────────────────────
  describe('dispatch', () => {
    it('routes HEAVY_JOB_CREATED to WorkerController', async () => {
      const event = makeEvent();
      await (service as any).dispatch(event);
      expect(controller.handleHeavyJobCreated).toHaveBeenCalledWith(event);
    });

    it('routes ORG_DELETION_REQUESTED to WorkerController', async () => {
      const event = makeEvent({
        eventType: DOMAIN_EVENTS.ORG_DELETION_REQUESTED,
      });
      await (service as any).dispatch(event);
      expect(controller.handleOrgDeletionRequested).toHaveBeenCalledWith(event);
    });

    it('routes org.export.requested to WorkerController', async () => {
      const event = makeEvent({ eventType: 'org.export.requested' });
      await (service as any).dispatch(event);
      expect(controller.handleOrgExportRequested).toHaveBeenCalledWith(event);
    });

    it('logs a warning and does not throw for unknown event types', async () => {
      const event = makeEvent({ eventType: 'unknown.event' });
      await expect((service as any).dispatch(event)).resolves.not.toThrow();
      expect(controller.handleHeavyJobCreated).not.toHaveBeenCalled();
    });
  });

  // ── sleep ───────────────────────────────────────────────────────────────────
  describe('sleep', () => {
    it('resolves after the given number of milliseconds', async () => {
      await expect((service as any).sleep(0)).resolves.toBeUndefined();
    });
  });
});
