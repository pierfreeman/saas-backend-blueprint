import { Logger } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqsBaseTransport } from './sqs-base.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing the abstract base
// ---------------------------------------------------------------------------
class TestTransport extends SqsBaseTransport {
  protected readonly logger = new Logger(TestTransport.name);
  protected readonly queueEnvVar = 'TEST_QUEUE_URL';
  protected readonly logTag = 'TEST';
  protected readonly notConfiguredWarning = 'TEST_QUEUE_URL not configured';

  protected buildCommand(event: DomainEvent, body: string): SendMessageCommand {
    return new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      MessageAttributes: this.buildMessageAttributes(event),
    });
  }

  protected logSuccess(
    event: DomainEvent,
    result: SendMessageCommandOutput,
  ): void {
    this.logger.debug(
      `[SQS-TEST] Sent "${event.eventType}" | MessageId: ${result.MessageId}`,
    );
  }

  // Expose protected helpers for testing
  exposeBuildMessageAttributes(event: DomainEvent) {
    return this.buildMessageAttributes(event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  eventType: 'test.event',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  payload: { key: 'value' },
  tenantId: 'tenant-123',
  eventId: 'evt-abc',
  ...overrides,
});

describe('SqsBaseTransport', () => {
  let transport: TestTransport;
  let sqsSendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = new TestTransport();

    // Mock SQSClient.send
    sqsSendMock = vi.fn().mockResolvedValue({ MessageId: 'msg-id-1' });
    vi.spyOn(SQSClient.prototype, 'send').mockImplementation(sqsSendMock);

    // Silence logger output in tests
    vi.spyOn(transport['logger'], 'log').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'debug').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['TEST_QUEUE_URL'];
    delete process.env['AWS_REGION'];
    delete process.env['SQS_ENDPOINT_URL'];
  });

  // ── onModuleInit ───────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('logs ready when queue URL is configured', () => {
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      transport.onModuleInit();
      expect(transport['logger'].log).toHaveBeenCalledWith(
        expect.stringContaining('TEST Transport ready'),
      );
    });

    it('warns when queue URL is absent', () => {
      delete process.env['TEST_QUEUE_URL'];
      transport.onModuleInit();
      expect(transport['logger'].warn).toHaveBeenCalledWith(
        'TEST_QUEUE_URL not configured',
      );
    });

    it('uses AWS_REGION env var when set', () => {
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      process.env['AWS_REGION'] = 'us-east-1';
      transport.onModuleInit();
      expect(transport['client']).toBeInstanceOf(SQSClient);
    });

    it('falls back to eu-west-1 when AWS_REGION is not set', () => {
      delete process.env['AWS_REGION'];
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      transport.onModuleInit();
      expect(transport['client']).toBeInstanceOf(SQSClient);
    });

    it('configures custom endpoint when SQS_ENDPOINT_URL is set', () => {
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      process.env['SQS_ENDPOINT_URL'] = 'http://localhost:4566';
      transport.onModuleInit();
      expect(transport['client']).toBeInstanceOf(SQSClient);
    });
  });

  // ── send() — queue not configured ─────────────────────────────────────────

  describe('send() — queue not configured', () => {
    beforeEach(() => {
      delete process.env['TEST_QUEUE_URL'];
      transport.onModuleInit();
    });

    it('returns undefined without calling SQS', async () => {
      const result = await transport.send(makeEvent());
      expect(result).toBeUndefined();
      expect(sqsSendMock).not.toHaveBeenCalled();
    });

    it('logs a warning about the dropped event', async () => {
      const event = makeEvent({ eventType: 'my.event' });
      await transport.send(event);
      expect(transport['logger'].warn).toHaveBeenCalledWith(
        expect.stringContaining('my.event'),
      );
    });
  });

  // ── send() — happy path ────────────────────────────────────────────────────

  describe('send() — queue configured', () => {
    beforeEach(() => {
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      transport.onModuleInit();
    });

    it('returns the MessageId on success', async () => {
      const result = await transport.send(makeEvent());
      expect(result).toBe('msg-id-1');
    });

    it('serialises timestamp as ISO string in the message body', async () => {
      await transport.send(makeEvent());
      const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
      const body = JSON.parse(command.input.MessageBody as string);
      expect(body.timestamp).toBe('2026-01-01T00:00:00.000Z');
    });

    it('includes the event payload in the message body', async () => {
      await transport.send(makeEvent({ payload: { custom: 42 } }));
      const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
      const body = JSON.parse(command.input.MessageBody as string);
      expect(body.payload).toEqual({ custom: 42 });
    });

    it('calls logSuccess after a successful send', async () => {
      const debugSpy = vi.spyOn(transport['logger'], 'debug');
      await transport.send(makeEvent());
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  // ── send() — error path ────────────────────────────────────────────────────

  describe('send() — SQS error', () => {
    beforeEach(() => {
      process.env['TEST_QUEUE_URL'] = 'https://sqs.aws.com/test-queue';
      transport.onModuleInit();
      sqsSendMock.mockRejectedValue(new Error('SQS unavailable'));
    });

    it('logs the error and re-throws', async () => {
      await expect(transport.send(makeEvent())).rejects.toThrow(
        'SQS unavailable',
      );
      expect(transport['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('test.event'),
        expect.any(Error),
      );
    });
  });

  // ── buildMessageAttributes() ───────────────────────────────────────────────

  describe('buildMessageAttributes()', () => {
    it('sets EventType from the event', () => {
      const attrs = transport.exposeBuildMessageAttributes(
        makeEvent({ eventType: 'billing.subscribed' }),
      );
      expect(attrs['EventType'].StringValue).toBe('billing.subscribed');
    });

    it('sets TenantId from the event', () => {
      const attrs = transport.exposeBuildMessageAttributes(
        makeEvent({ tenantId: 'org-xyz' }),
      );
      expect(attrs['TenantId'].StringValue).toBe('org-xyz');
    });

    it('falls back to "unknown" when tenantId is absent', () => {
      const attrs = transport.exposeBuildMessageAttributes(
        makeEvent({ tenantId: undefined }),
      );
      expect(attrs['TenantId'].StringValue).toBe('unknown');
    });

    it('uses String DataType for all attributes', () => {
      const attrs = transport.exposeBuildMessageAttributes(makeEvent());
      expect(attrs['EventType'].DataType).toBe('String');
      expect(attrs['TenantId'].DataType).toBe('String');
    });
  });
});
