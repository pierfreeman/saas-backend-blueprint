import { ServiceBusClient } from '@azure/service-bus';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceBusStandardTransport } from './servicebus-standard.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

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

describe('ServiceBusStandardTransport', () => {
  let transport: ServiceBusStandardTransport;
  let mockSender: {
    sendMessages: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    transport = new ServiceBusStandardTransport();

    mockSender = {
      sendMessages: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(ServiceBusClient.prototype, 'createSender').mockReturnValue(
      mockSender as any,
    );

    vi.spyOn(transport['logger'], 'log').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'debug').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'error').mockImplementation(() => undefined);

    process.env['SERVICEBUS_CONNECTION_STRING'] = FAKE_CONNECTION_STRING;
    process.env['SERVICEBUS_STANDARD_QUEUE_NAME'] = 'saas-backend-standard';
    transport.onModuleInit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SERVICEBUS_CONNECTION_STRING'];
    delete process.env['SERVICEBUS_STANDARD_QUEUE_NAME'];
  });

  it('should be instantiable', () => {
    expect(transport).toBeDefined();
  });

  it('uses SERVICEBUS_STANDARD_QUEUE_NAME as queue', () => {
    expect(transport['queueName']).toBe('saas-backend-standard');
  });

  describe('buildMessage()', () => {
    it('includes the eventType in applicationProperties', async () => {
      await transport.send(makeEvent({ eventType: 'job.created' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.applicationProperties.eventType).toBe('job.created');
    });

    it('includes the tenantId in applicationProperties', async () => {
      await transport.send(makeEvent({ tenantId: 'org-88' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.applicationProperties.tenantId).toBe('org-88');
    });

    it('falls back to "unknown" when tenantId is undefined', async () => {
      await transport.send(makeEvent({ tenantId: undefined }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.applicationProperties.tenantId).toBe('unknown');
    });

    it('sets messageId to eventId', async () => {
      await transport.send(makeEvent({ eventId: 'my-event-id' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.messageId).toBe('my-event-id');
    });

    it('serialises timestamp as ISO string in message body', async () => {
      await transport.send(makeEvent());
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.body.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });

    it('does NOT set sessionId (standard queue has no sessions)', async () => {
      await transport.send(makeEvent());
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.sessionId).toBeUndefined();
    });
  });
});
