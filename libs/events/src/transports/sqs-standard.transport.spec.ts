import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqsStandardTransport } from './sqs-standard.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  eventType: 'test.event',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  payload: { key: 'value' },
  tenantId: 'tenant-123',
  eventId: 'evt-abc',
  ...overrides,
});

describe('SqsStandardTransport', () => {
  let transport: SqsStandardTransport;
  let sqsSendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = new SqsStandardTransport();
    sqsSendMock = vi.fn().mockResolvedValue({ MessageId: 'msg-std-1' });
    vi.spyOn(SQSClient.prototype, 'send').mockImplementation(sqsSendMock);
    vi.spyOn(transport['logger'], 'log').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'debug').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'error').mockImplementation(() => undefined);

    process.env['SQS_STANDARD_QUEUE_URL'] =
      'https://sqs.aws.com/standard-queue';
    transport.onModuleInit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SQS_STANDARD_QUEUE_URL'];
  });

  it('uses SQS_STANDARD_QUEUE_URL as the queue URL', () => {
    expect(transport['queueUrl']).toBe('https://sqs.aws.com/standard-queue');
  });

  it('sends a standard SendMessageCommand without FIFO params', async () => {
    await transport.send(makeEvent());
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageGroupId).toBeUndefined();
    expect(command.input.MessageDeduplicationId).toBeUndefined();
  });

  it('sets QueueUrl on the command', async () => {
    await transport.send(makeEvent());
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.QueueUrl).toBe('https://sqs.aws.com/standard-queue');
  });

  it('returns the MessageId', async () => {
    const result = await transport.send(makeEvent());
    expect(result).toBe('msg-std-1');
  });

  it('includes EventType and TenantId in MessageAttributes', async () => {
    await transport.send(
      makeEvent({ eventType: 'job.created', tenantId: 'org-1' }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageAttributes?.['EventType'].StringValue).toBe(
      'job.created',
    );
    expect(command.input.MessageAttributes?.['TenantId'].StringValue).toBe(
      'org-1',
    );
  });

  it('logs a debug message after successful send', async () => {
    await transport.send(makeEvent());
    expect(transport['logger'].debug).toHaveBeenCalledWith(
      expect.stringContaining('STANDARD'),
    );
  });

  it('warns and returns undefined when queue URL is not configured', async () => {
    delete process.env['SQS_STANDARD_QUEUE_URL'];
    const t = new SqsStandardTransport();
    vi.spyOn(t['logger'], 'warn').mockImplementation(() => undefined);
    t.onModuleInit();
    const result = await t.send(makeEvent());
    expect(result).toBeUndefined();
    expect(sqsSendMock).not.toHaveBeenCalled();
  });
});
