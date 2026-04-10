import { Logger } from '@nestjs/common';
import { ServiceBusClient, ServiceBusMessage } from '@azure/service-bus';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceBusBaseTransport } from './servicebus-base.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

// ── Minimal concrete subclass for testing the abstract base ─────────────────

class TestTransport extends ServiceBusBaseTransport {
  protected readonly logger = new Logger(TestTransport.name);
  protected readonly queueEnvVar = 'TEST_SB_QUEUE_NAME';
  protected readonly logTag = 'TEST';
  protected readonly notConfiguredWarning = 'TEST_SB_QUEUE_NAME not configured';

  protected buildMessage(event: DomainEvent): ServiceBusMessage {
    return {
      body: { ...event, timestamp: event.timestamp.toISOString() },
      messageId: event.eventId,
    };
  }

  protected logSuccess(event: DomainEvent): void {
    this.logger.debug(`[SB-TEST] Sent "${event.eventType}"`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FAKE_CONNECTION_STRING =
  'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=test;SharedAccessKey=dGVzdA==';

const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  eventType: 'test.event',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  payload: { key: 'value' },
  tenantId: 'tenant-123',
  eventId: 'evt-abc',
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ServiceBusBaseTransport', () => {
  let transport: TestTransport;
  let mockSender: {
    sendMessages: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let createSenderSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    transport = new TestTransport();

    mockSender = {
      sendMessages: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    createSenderSpy = vi
      .spyOn(ServiceBusClient.prototype, 'createSender')
      .mockReturnValue(mockSender as any);

    // Silence logger output
    vi.spyOn(transport['logger'], 'log').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'debug').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['TEST_SB_QUEUE_NAME'];
    delete process.env['SERVICEBUS_CONNECTION_STRING'];
  });

  // ── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('logs ready and creates sender when both env vars are set', () => {
      process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
      process.env['TEST_SB_QUEUE_NAME'] = 'my-queue';

      transport.onModuleInit();

      expect(createSenderSpy).toHaveBeenCalledWith('my-queue');
      expect(transport['logger'].log).toHaveBeenCalledWith(
        expect.stringContaining('TEST Transport ready'),
      );
    });

    it('warns and does not create sender when connection string is absent', () => {
      delete process.env['SERVICEBUS_CONNECTION_STRING'];
      process.env['TEST_SB_QUEUE_NAME'] = 'my-queue';

      transport.onModuleInit();

      expect(createSenderSpy).not.toHaveBeenCalled();
      expect(transport['logger'].warn).toHaveBeenCalledWith(
        'TEST_SB_QUEUE_NAME not configured',
      );
    });

    it('warns and does not create sender when queue name is absent', () => {
      process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
      delete process.env['TEST_SB_QUEUE_NAME'];

      transport.onModuleInit();

      expect(createSenderSpy).not.toHaveBeenCalled();
      expect(transport['logger'].warn).toHaveBeenCalledWith(
        'TEST_SB_QUEUE_NAME not configured',
      );
    });
  });

  // ── send() — sender not initialised ──────────────────────────────────────

  describe('send() — sender not initialised', () => {
    beforeEach(() => {
      // Do NOT call onModuleInit() — sender stays undefined
    });

    it('returns undefined without calling sendMessages', async () => {
      const result = await transport.send(makeEvent());
      expect(result).toBeUndefined();
      expect(mockSender.sendMessages).not.toHaveBeenCalled();
    });

    it('logs a warning about the dropped event', async () => {
      const event = makeEvent({ eventType: 'my.event' });
      await transport.send(event);
      expect(transport['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('my.event'),
      );
    });
  });

  // ── send() — happy path ───────────────────────────────────────────────────

  describe('send() — sender configured', () => {
    beforeEach(() => {
      process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
      process.env['TEST_SB_QUEUE_NAME'] = 'my-queue';
      transport.onModuleInit();
    });

    it('returns the eventId on success', async () => {
      const event = makeEvent({ eventId: 'evt-return' });
      const result = await transport.send(event);
      expect(result).toBe('evt-return');
    });

    it('calls sendMessages once with the built message', async () => {
      await transport.send(makeEvent());
      expect(mockSender.sendMessages).toHaveBeenCalledTimes(1);
    });

    it('calls logSuccess (debug) after a successful send', async () => {
      await transport.send(makeEvent());
      expect(transport['logger'].debug).toHaveBeenCalled();
    });
  });

  // ── send() — error path ───────────────────────────────────────────────────

  describe('send() — Service Bus error', () => {
    beforeEach(() => {
      process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
      process.env['TEST_SB_QUEUE_NAME'] = 'my-queue';
      transport.onModuleInit();
      mockSender.sendMessages.mockRejectedValue(new Error('SB unavailable'));
    });

    it('logs the error and re-throws', async () => {
      await expect(transport.send(makeEvent())).rejects.toThrow(
        'SB unavailable',
      );
      expect(transport['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('test.event'),
        expect.any(Error),
      );
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('calls close on sender and client when they exist', async () => {
      process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
      process.env['TEST_SB_QUEUE_NAME'] = 'my-queue';
      transport.onModuleInit();

      const clientCloseSpy = vi
        .spyOn(transport['client'], 'close')
        .mockResolvedValue(undefined);

      await transport.onModuleDestroy();

      expect(mockSender.close).toHaveBeenCalled();
      expect(clientCloseSpy).toHaveBeenCalled();
    });

    it('does not throw when called before onModuleInit', async () => {
      await expect(transport.onModuleDestroy()).resolves.not.toThrow();
    });
  });
});
