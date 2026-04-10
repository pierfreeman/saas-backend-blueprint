import { ServiceBusConsumerService } from './servicebus-consumer.service';
import { WorkerController, HeavyJobPayload } from './worker.controller';
import { DOMAIN_EVENTS, DomainEvent } from '@libs/events';
import { Mocked, vi } from 'vitest';

// ── Azure Service Bus SDK mock ────────────────────────────────────────────────

const {
  mockReceiveMessages,
  mockCompleteMessage,
  mockAbandonMessage,
  mockDeadLetterMessage,
  mockReceiverClose,
  mockClientClose,
} = vi.hoisted(() => ({
  mockReceiveMessages: vi.fn(),
  mockCompleteMessage: vi.fn().mockResolvedValue(undefined),
  mockAbandonMessage: vi.fn().mockResolvedValue(undefined),
  mockDeadLetterMessage: vi.fn().mockResolvedValue(undefined),
  mockReceiverClose: vi.fn().mockResolvedValue(undefined),
  mockClientClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@azure/service-bus', () => ({
  ServiceBusClient: vi.fn(function (this: unknown) {
    return {
      createReceiver: vi.fn().mockReturnValue({
        receiveMessages: mockReceiveMessages,
        completeMessage: mockCompleteMessage,
        abandonMessage: mockAbandonMessage,
        deadLetterMessage: mockDeadLetterMessage,
        close: mockReceiverClose,
      }),
      close: mockClientClose,
    };
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeController(): Mocked<WorkerController> {
  return {
    handleHeavyJobCreated: vi.fn().mockResolvedValue(undefined),
    handleOrgDeletionRequested: vi.fn().mockResolvedValue(undefined),
    handleOrgExportRequested: vi.fn().mockResolvedValue(undefined),
    handleUserInvited: vi.fn().mockResolvedValue(undefined),
    handleBillingPlanChanged: vi.fn().mockResolvedValue(undefined),
    handleBillingPaymentSucceeded: vi.fn().mockResolvedValue(undefined),
    handleBillingSubscriptionCancelled: vi.fn().mockResolvedValue(undefined),
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

function makeSbMessage(body: unknown, messageId = 'msg-1') {
  return { body, messageId };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ServiceBusConsumerService', () => {
  let controller: Mocked<WorkerController>;
  let service: ServiceBusConsumerService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['EVENT_BUS_TRANSPORT'];
    delete process.env['SERVICEBUS_CONNECTION_STRING'];
    delete process.env['SERVICEBUS_STANDARD_QUEUE_NAME'];
    controller = makeController();
    service = new ServiceBusConsumerService(controller);
  });

  // ── onModuleInit ────────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('does not start when EVENT_BUS_TRANSPORT is not servicebus', () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'local';
      service.onModuleInit();
      expect((service as any).running).toBe(false);
    });

    it('does not start when SERVICEBUS_CONNECTION_STRING is missing', () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'servicebus';
      process.env['SERVICEBUS_STANDARD_QUEUE_NAME'] = 'my-queue';
      // no connection string
      service.onModuleInit();
      expect((service as any).running).toBe(false);
    });

    it('does not start when SERVICEBUS_STANDARD_QUEUE_NAME is missing', () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'servicebus';
      process.env['SERVICEBUS_CONNECTION_STRING'] =
        'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=dGVzdA==';
      // no queue name
      service.onModuleInit();
      expect((service as any).running).toBe(false);
    });

    it('starts polling when fully configured', () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'servicebus';
      process.env['SERVICEBUS_CONNECTION_STRING'] =
        'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=dGVzdA==';
      process.env['SERVICEBUS_STANDARD_QUEUE_NAME'] = 'my-queue';

      const svc = new ServiceBusConsumerService(controller);
      const pollSpy = vi.spyOn(svc as any, 'poll').mockResolvedValue(undefined);

      svc.onModuleInit();

      expect((svc as any).running).toBe(true);
      expect(pollSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── onModuleDestroy ─────────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('sets running to false', async () => {
      (service as any).running = true;
      await service.onModuleDestroy();
      expect((service as any).running).toBe(false);
    });

    it('does not throw when called before onModuleInit', async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });
  });

  // ── processMessage ──────────────────────────────────────────────────────────

  describe('processMessage', () => {
    beforeEach(() => {
      (service as any).receiver = {
        receiveMessages: mockReceiveMessages,
        completeMessage: mockCompleteMessage,
        abandonMessage: mockAbandonMessage,
        deadLetterMessage: mockDeadLetterMessage,
        close: mockReceiverClose,
      };
    });

    it('dispatches the event and completes the message on success', async () => {
      const event = makeEvent();
      const msg = makeSbMessage(event);

      await (service as any).processMessage(msg);

      expect(controller.handleHeavyJobCreated).toHaveBeenCalledTimes(1);
      expect(mockCompleteMessage).toHaveBeenCalledWith(msg);
    });

    it('abandons the message when the handler throws', async () => {
      controller.handleHeavyJobCreated.mockRejectedValueOnce(
        new Error('handler error'),
      );
      const msg = makeSbMessage(makeEvent());

      await (service as any).processMessage(msg);

      expect(mockCompleteMessage).not.toHaveBeenCalled();
      expect(mockAbandonMessage).toHaveBeenCalledWith(msg);
    });

    it('dead-letters the message when the body cannot be parsed', async () => {
      const msg = { body: '{invalid-json', messageId: 'mid-bad' };

      await expect((service as any).processMessage(msg)).resolves.not.toThrow();
      expect(mockDeadLetterMessage).toHaveBeenCalledWith(
        msg,
        expect.objectContaining({ deadLetterReason: 'ParseFailure' }),
      );
    });

    it('abandons when dead-letter itself throws', async () => {
      const msg = { body: '{invalid-json', messageId: 'mid-bad' };
      mockDeadLetterMessage.mockRejectedValueOnce(new Error('dl error'));

      await (service as any).processMessage(msg);

      expect(mockAbandonMessage).toHaveBeenCalledWith(msg);
    });

    it('rehydrates timestamp from string to Date', async () => {
      const event = makeEvent();
      const msg = makeSbMessage(event);

      await (service as any).processMessage(msg);

      const received: DomainEvent<HeavyJobPayload> =
        controller.handleHeavyJobCreated.mock.calls[0][0];
      expect(received.timestamp).toBeInstanceOf(Date);
    });

    it('parses body from JSON string (Service Bus string-format body)', async () => {
      const event = makeEvent();
      const msg = makeSbMessage(JSON.stringify(event));

      await (service as any).processMessage(msg);

      expect(controller.handleHeavyJobCreated).toHaveBeenCalledTimes(1);
      expect(mockCompleteMessage).toHaveBeenCalledWith(msg);
    });
  });

  // ── poll ───────────────────────────────────────────────────────────────────

  describe('poll', () => {
    it('processes received messages and exits when running becomes false', async () => {
      (service as any).receiver = {
        receiveMessages: mockReceiveMessages,
        completeMessage: mockCompleteMessage,
        abandonMessage: mockAbandonMessage,
        deadLetterMessage: mockDeadLetterMessage,
        close: mockReceiverClose,
      };
      (service as any).running = true;

      const msg = makeSbMessage(makeEvent());

      // First receives one message; second call exits loop
      mockReceiveMessages
        .mockResolvedValueOnce([msg])
        .mockImplementationOnce(() => {
          (service as any).running = false;
          return Promise.resolve([]);
        });

      await (service as any).poll();

      expect(controller.handleHeavyJobCreated).toHaveBeenCalledTimes(1);
    });

    it('logs error, sleeps 5 s, then retries after a receive failure', async () => {
      (service as any).receiver = {
        receiveMessages: mockReceiveMessages,
        completeMessage: mockCompleteMessage,
        abandonMessage: mockAbandonMessage,
        deadLetterMessage: mockDeadLetterMessage,
        close: mockReceiverClose,
      };
      (service as any).running = true;

      const sleepSpy = vi
        .spyOn(service as any, 'sleep')
        .mockResolvedValue(undefined);

      mockReceiveMessages
        .mockRejectedValueOnce(new Error('network error'))
        .mockImplementationOnce(() => {
          (service as any).running = false;
          return Promise.resolve([]);
        });

      await (service as any).poll();

      expect(sleepSpy).toHaveBeenCalledWith(5000);
    });
  });

  // ── dispatch ───────────────────────────────────────────────────────────────

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

    it('routes ORG_EXPORT_REQUESTED to WorkerController', async () => {
      const event = makeEvent({ eventType: 'org.export.requested' });
      await (service as any).dispatch(event);
      expect(controller.handleOrgExportRequested).toHaveBeenCalledWith(event);
    });

    it('routes USER_INVITED to WorkerController', async () => {
      const event = makeEvent({ eventType: DOMAIN_EVENTS.USER_INVITED });
      await (service as any).dispatch(event);
      expect(controller.handleUserInvited).toHaveBeenCalledWith(event);
    });

    it('routes SUBSCRIPTION_PLAN_CHANGED to WorkerController', async () => {
      const event = makeEvent({
        eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
      });
      await (service as any).dispatch(event);
      expect(controller.handleBillingPlanChanged).toHaveBeenCalledWith(event);
    });

    it('routes BILLING_PAYMENT_SUCCEEDED to WorkerController', async () => {
      const event = makeEvent({
        eventType: DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED,
      });
      await (service as any).dispatch(event);
      expect(controller.handleBillingPaymentSucceeded).toHaveBeenCalledWith(
        event,
      );
    });

    it('routes BILLING_SUBSCRIPTION_CANCELLED to WorkerController', async () => {
      const event = makeEvent({
        eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
      });
      await (service as any).dispatch(event);
      expect(
        controller.handleBillingSubscriptionCancelled,
      ).toHaveBeenCalledWith(event);
    });

    it('logs a warning and does not throw for unknown event types', async () => {
      const event = makeEvent({ eventType: 'unknown.event' });
      await expect((service as any).dispatch(event)).resolves.not.toThrow();
    });
  });
});
