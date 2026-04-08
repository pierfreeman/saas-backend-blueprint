import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqsFifoTransport } from './sqs-fifo.transport';
import { DomainEvent } from '../interfaces/domain-event.interface';

const makeEvent = (overrides: Partial<DomainEvent> = {}): DomainEvent => ({
  eventType: 'billing.subscribed',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  payload: { plan: 'pro' },
  tenantId: 'tenant-456',
  eventId: 'evt-fifo-1',
  ...overrides,
});

describe('SqsFifoTransport', () => {
  let transport: SqsFifoTransport;
  let sqsSendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transport = new SqsFifoTransport();
    sqsSendMock = vi.fn().mockResolvedValue({ MessageId: 'msg-fifo-1' });
    vi.spyOn(SQSClient.prototype, 'send').mockImplementation(sqsSendMock);
    vi.spyOn(transport['logger'], 'log').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'warn').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'debug').mockImplementation(() => undefined);
    vi.spyOn(transport['logger'], 'error').mockImplementation(() => undefined);

    process.env['SQS_FIFO_QUEUE_URL'] = 'https://sqs.aws.com/billing.fifo';
    transport.onModuleInit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['SQS_FIFO_QUEUE_URL'];
  });

  it('uses SQS_FIFO_QUEUE_URL as the queue URL', () => {
    expect(transport['queueUrl']).toBe('https://sqs.aws.com/billing.fifo');
  });

  it('sets MessageGroupId to tenantId when messageGroupId is absent', async () => {
    await transport.send(
      makeEvent({ tenantId: 'org-7', messageGroupId: undefined }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageGroupId).toBe('org-7');
  });

  it('prefers explicit messageGroupId over tenantId', async () => {
    await transport.send(
      makeEvent({ messageGroupId: 'custom-group', tenantId: 'org-7' }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageGroupId).toBe('custom-group');
  });

  it('falls back to "default" when both messageGroupId and tenantId are absent', async () => {
    await transport.send(
      makeEvent({ messageGroupId: undefined, tenantId: undefined }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageGroupId).toBe('default');
  });

  it('sets MessageDeduplicationId to eventId', async () => {
    await transport.send(makeEvent({ eventId: 'dedup-xyz' }));
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageDeduplicationId).toBe('dedup-xyz');
  });

  it('falls back deduplication ID to messageGroupId when eventId is absent', async () => {
    await transport.send(
      makeEvent({ eventId: undefined, messageGroupId: 'grp-1' }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageDeduplicationId).toBe('grp-1');
  });

  it('sets QueueUrl on the command', async () => {
    await transport.send(makeEvent());
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.QueueUrl).toBe('https://sqs.aws.com/billing.fifo');
  });

  it('returns the MessageId', async () => {
    const result = await transport.send(makeEvent());
    expect(result).toBe('msg-fifo-1');
  });

  it('includes EventType and TenantId in MessageAttributes', async () => {
    await transport.send(
      makeEvent({ eventType: 'billing.subscribed', tenantId: 'org-9' }),
    );
    const command: SendMessageCommand = sqsSendMock.mock.calls[0][0];
    expect(command.input.MessageAttributes?.['EventType'].StringValue).toBe(
      'billing.subscribed',
    );
    expect(command.input.MessageAttributes?.['TenantId'].StringValue).toBe(
      'org-9',
    );
  });

  it('includes the group ID in the debug log after successful send', async () => {
    await transport.send(
      makeEvent({ messageGroupId: 'grp-debug', tenantId: 'org-1' }),
    );
    expect(transport['logger'].debug).toHaveBeenCalledWith(
      expect.stringContaining('grp-debug'),
    );
  });

  it('warns and returns undefined when queue URL is not configured', async () => {
    delete process.env['SQS_FIFO_QUEUE_URL'];
    const t = new SqsFifoTransport();
    vi.spyOn(t['logger'], 'warn').mockImplementation(() => undefined);
    t.onModuleInit();
    const result = await t.send(makeEvent());
    expect(result).toBeUndefined();
    expect(sqsSendMock).not.toHaveBeenCalled();
  });
});
