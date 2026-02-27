/**
 * Unit tests for PubSubService.
 *
 * The PubSubService creates two ioredis connections (publisher + subscriber).
 * We capture them by order of construction: first call = publisher, second = subscriber.
 */
jest.mock('ioredis', () => {
  const makeInstance = () => ({
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    psubscribe: jest.fn().mockResolvedValue(undefined),
  });

  // Push instances onto Ctor.__instances so that assigning a new [] in beforeEach
  // always gives us a fresh, correctly-referenced array for each test.
  const Ctor: any = jest.fn(() => {
    const inst = makeInstance();
    Ctor.__instances.push(inst);
    return inst;
  });
  Ctor.__instances = [];

  return { __esModule: true, default: Ctor };
});

import Redis from 'ioredis';
import { PubSubService } from './pubsub.service';

/** Shape of each mock ioredis instance created by the factory above. */
type IoRedisMock = {
  on: jest.Mock;
  quit: jest.Mock;
  publish: jest.Mock;
  subscribe: jest.Mock;
  psubscribe: jest.Mock;
};

// Helper to access the captured instances.
const getInstances = () => (Redis as any).__instances as IoRedisMock[];

describe('PubSubService', () => {
  let service: PubSubService;

  beforeEach(() => {
    jest.clearAllMocks();
    (Redis as any).__instances = [];
    service = new PubSubService();
  });

  // ── Publish ─────────────────────────────────────────────────────────────────

  describe('publish', () => {
    it('serializes the payload and calls publish on the publisher connection', async () => {
      const [publisher] = getInstances();
      await service.publish('notifications:org-1', {
        type: 'new-message',
        data: 42,
      });

      expect(publisher.publish).toHaveBeenCalledWith(
        'notifications:org-1',
        JSON.stringify({ type: 'new-message', data: 42 }),
      );
    });

    it('does NOT call publish on the subscriber connection', async () => {
      const [, subscriber] = getInstances();
      await service.publish('ch', {});
      expect(subscriber.publish).not.toHaveBeenCalled();
    });

    it('re-throws when the underlying publish fails', async () => {
      const [publisher] = getInstances();
      (publisher.publish as jest.Mock).mockRejectedValueOnce(
        new Error('Redis unavailable'),
      );
      await expect(service.publish('ch', {})).rejects.toThrow(
        'Redis unavailable',
      );
    });
  });

  // ── Subscribe ────────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('calls subscriber.subscribe with the given channel', () => {
      const [, subscriber] = getInstances();
      service.subscribe('job:update:org-1', jest.fn());
      expect(subscriber.subscribe).toHaveBeenCalledWith('job:update:org-1');
    });

    it('does NOT call subscribe on the publisher connection', () => {
      const [publisher] = getInstances();
      service.subscribe('ch', jest.fn());
      expect(publisher.subscribe).not.toHaveBeenCalled();
    });

    it('invokes the handler when a "message" event fires on the correct channel', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribe('job:update:org-1', handler);

      // Simulate the ioredis 'message' event
      const messageListener = (subscriber.on as jest.Mock).mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1] as ((ch: string, raw: string) => void) | undefined;

      expect(messageListener).toBeDefined();
      messageListener!('job:update:org-1', JSON.stringify({ jobId: 'j1' }));

      expect(handler).toHaveBeenCalledWith({ jobId: 'j1' });
    });

    it('does NOT invoke the handler for a different channel', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.subscribe('job:update:org-1', handler);

      const messageListener = (subscriber.on as jest.Mock).mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1] as ((ch: string, raw: string) => void) | undefined;

      messageListener!('job:update:OTHER', JSON.stringify({ jobId: 'j2' }));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── pSubscribe ───────────────────────────────────────────────────────────────

  describe('pSubscribe', () => {
    it('calls subscriber.psubscribe with the given pattern', () => {
      const [, subscriber] = getInstances();
      service.pSubscribe('job:update:*', jest.fn());
      expect(subscriber.psubscribe).toHaveBeenCalledWith('job:update:*');
    });

    it('invokes the handler with (channel, payload) when a "pmessage" event fires', () => {
      const [, subscriber] = getInstances();
      const handler = jest.fn();
      service.pSubscribe('job:update:*', handler);

      const pmsgListener = (subscriber.on as jest.Mock).mock.calls.find(
        ([event]: [string]) => event === 'pmessage',
      )?.[1] as ((pat: string, ch: string, raw: string) => void) | undefined;

      expect(pmsgListener).toBeDefined();
      pmsgListener!(
        'job:update:*',
        'job:update:org-1',
        JSON.stringify({ jobId: 'j3', status: 'DONE' }),
      );

      expect(handler).toHaveBeenCalledWith('job:update:org-1', {
        jobId: 'j3',
        status: 'DONE',
      });
    });
  });

  // ── getRedis ─────────────────────────────────────────────────────────────────

  describe('getRedis', () => {
    it('returns the publisher (first) connection', () => {
      const [publisher] = getInstances();
      expect(service.getRedis()).toBe(publisher);
    });
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('quits both publisher and subscriber connections', async () => {
      const [publisher, subscriber] = getInstances();
      await service.onModuleDestroy();
      expect(publisher.quit).toHaveBeenCalledTimes(1);
      expect(subscriber.quit).toHaveBeenCalledTimes(1);
    });
  });
});
