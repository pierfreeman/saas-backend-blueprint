import { ServiceBusClient } from '@azure/service-bus';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceBusSessionTransport } from './servicebus-session.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

const FAKE_CONNECTION_STRING =
  'Endpoint=sb://test.servicebus.windows.net/;SharedAccessKeyName=test;SharedAccessKey=dGVzdA==';

const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  eventType: 'billing.subscription.created',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  payload: {},
  tenantId: 'tenant-abc',
  eventId: 'evt-xyz',
  ...overrides,
});

describe('ServiceBusSessionTransport', () => {
  let transport: ServiceBusSessionTransport;
  let mockSender: {
    sendMessages: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    transport = new ServiceBusSessionTransport();

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
    process.env['SERVICEBUS_SESSION_QUEUE_NAME'] = 'saas-backend-sessions';
    transport.onModuleInit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SERVICEBUS_CONNECTION_STRING'];
    delete process.env['SERVICEBUS_SESSION_QUEUE_NAME'];
  });

  it('should be instantiable', () => {
    expect(transport).toBeDefined();
  });

  it('uses SERVICEBUS_SESSION_QUEUE_NAME as queue', () => {
    expect(transport['queueName']).toBe('saas-backend-sessions');
  });

  describe('buildMessage() — sessionId mapping', () => {
    it('uses messageGroupId as sessionId when provided', async () => {
      await transport.send(
        makeEvent({ messageGroupId: 'group-1', tenantId: 'tenant-abc' }),
      );
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.sessionId).toBe('group-1');
    });

    it('falls back to tenantId when messageGroupId is absent', async () => {
      await transport.send(makeEvent({ tenantId: 'tenant-abc' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.sessionId).toBe('tenant-abc');
    });

    it('falls back to "default" when both messageGroupId and tenantId are absent', async () => {
      await transport.send(
        makeEvent({ messageGroupId: undefined, tenantId: undefined }),
      );
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.sessionId).toBe('default');
    });
  });

  describe('buildMessage() — common fields', () => {
    it('sets messageId to eventId', async () => {
      await transport.send(makeEvent({ eventId: 'my-evt' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.messageId).toBe('my-evt');
    });

    it('serialises timestamp as ISO string in the body', async () => {
      await transport.send(makeEvent());
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.body.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });

    it('includes eventType in applicationProperties', async () => {
      await transport.send(
        makeEvent({ eventType: 'billing.payment.succeeded' }),
      );
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.applicationProperties.eventType).toBe(
        'billing.payment.succeeded',
      );
    });

    it('includes tenantId in applicationProperties', async () => {
      await transport.send(makeEvent({ tenantId: 'tenant-zz' }));
      const msg = mockSender.sendMessages.mock.calls[0][0];
      expect(msg.applicationProperties.tenantId).toBe('tenant-zz');
    });
  });
});
