/**
 * Unit tests for PubSubService.
 *
 * The PubSubService creates two ioredis connections (publisher + subscriber).
 * We capture them by order of construction: first call = publisher, second = subscriber.
 */
vi.mock('ioredis', () => {
  const makeInstance = () => ({
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    publish: vi.fn().mockResolvedValue(1),
    subscribe: vi.fn().mockResolvedValue(undefined),
    psubscribe: vi.fn().mockResolvedValue(undefined),
  });

  // Push instances onto Ctor.__instances so that assigning a new [] in beforeEach
  // always gives us a fresh, correctly-referenced array for each test.
  const Ctor: any = vi.fn(function (this: any) {
    const inst = makeInstance();
    Ctor.__instances.push(inst);
    return inst;
  });
  Ctor.__instances = [];

  return { __esModule: true, default: Ctor };
});

import Redis from 'ioredis';
import { PubSubService } from './pubsub.service';
import { Mock, vi } from 'vitest';

/** Shape of each mock ioredis instance created by the factory above. */
type IoRedisMock = {
  on: Mock;
  quit: Mock;
  publish: Mock;
  subscribe: Mock;
  psubscribe: Mock;
};

// Helper to access the captured instances.
const getInstances = () => (Redis as any).__instances as IoRedisMock[];

describe('PubSubService', () => {
  let service: PubSubService;

  beforeEach(() => {
    vi.clearAllMocks();
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
      (publisher.publish as Mock).mockRejectedValueOnce(
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
      service.subscribe('job:update:org-1', vi.fn());
      expect(subscriber.subscribe).toHaveBeenCalledWith('job:update:org-1');
    });

    it('does NOT call subscribe on the publisher connection', () => {
      const [publisher] = getInstances();
      service.subscribe('ch', vi.fn());
      expect(publisher.subscribe).not.toHaveBeenCalled();
    });

    it('invokes the handler when a "message" event fires on the correct channel', () => {
      const [, subscriber] = getInstances();
      const handler = vi.fn();
      service.subscribe('job:update:org-1', handler);

      // Simulate the ioredis 'message' event
      const messageListener = (subscriber.on as Mock).mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1] as ((ch: string, raw: string) => void) | undefined;

      expect(messageListener).toBeDefined();
      messageListener!('job:update:org-1', JSON.stringify({ jobId: 'j1' }));

      expect(handler).toHaveBeenCalledWith({ jobId: 'j1' });
    });

    it('does NOT invoke the handler for a different channel', () => {
      const [, subscriber] = getInstances();
      const handler = vi.fn();
      service.subscribe('job:update:org-1', handler);

      const messageListener = (subscriber.on as Mock).mock.calls.find(
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
      service.pSubscribe('job:update:*', vi.fn());
      expect(subscriber.psubscribe).toHaveBeenCalledWith('job:update:*');
    });

    it('invokes the handler with (channel, payload) when a "pmessage" event fires', () => {
      const [, subscriber] = getInstances();
      const handler = vi.fn();
      service.pSubscribe('job:update:*', handler);

      const pmsgListener = (subscriber.on as Mock).mock.calls.find(
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

  // ── Constructor event callbacks ───────────────────────────────────────────────

  describe('constructor event callbacks', () => {
    it('invokes the publisher connect callback without throwing', () => {
      const [publisher] = getInstances();
      const cb = (publisher.on as Mock).mock.calls.find(
        ([e]: [string]) => e === 'connect',
      )?.[1] as (() => void) | undefined;
      expect(() => cb?.()).not.toThrow();
    });

    it('invokes the publisher error callback without throwing', () => {
      const [publisher] = getInstances();
      const cb = (publisher.on as Mock).mock.calls.find(
        ([e]: [string]) => e === 'error',
      )?.[1] as ((err: Error) => void) | undefined;
      expect(() => cb?.(new Error('pub error'))).not.toThrow();
    });

    it('invokes the subscriber connect callback without throwing', () => {
      const [, subscriber] = getInstances();
      const cb = (subscriber.on as Mock).mock.calls.find(
        ([e]: [string]) => e === 'connect',
      )?.[1] as (() => void) | undefined;
      expect(() => cb?.()).not.toThrow();
    });

    it('invokes the subscriber error callback without throwing', () => {
      const [, subscriber] = getInstances();
      const cb = (subscriber.on as Mock).mock.calls.find(
        ([e]: [string]) => e === 'error',
      )?.[1] as ((err: Error) => void) | undefined;
      expect(() => cb?.(new Error('sub error'))).not.toThrow();
    });
  });

  // ── subscribe — parse error path ──────────────────────────────────────────────

  describe('subscribe — parse error', () => {
    it('logs an error when the message event contains invalid JSON', () => {
      const [, subscriber] = getInstances();
      const loggerSpy = vi
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      service.subscribe('ch', vi.fn());

      const messageListener = (subscriber.on as Mock).mock.calls.find(
        ([event]: [string]) => event === 'message',
      )?.[1] as ((ch: string, raw: string) => void) | undefined;

      messageListener?.('ch', '{NOT_VALID_JSON}}}');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse message from channel "ch"'),
      );
    });
  });

  // ── pSubscribe — parse error path ─────────────────────────────────────────────

  describe('pSubscribe — parse error', () => {
    it('logs an error when the pmessage event contains invalid JSON', () => {
      const [, subscriber] = getInstances();
      const loggerSpy = vi
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      service.pSubscribe('ch:*', vi.fn());

      const pmsgListener = (subscriber.on as Mock).mock.calls.find(
        ([event]: [string]) => event === 'pmessage',
      )?.[1] as ((pat: string, ch: string, raw: string) => void) | undefined;

      pmsgListener?.('ch:*', 'ch:1', '{NOT_VALID_JSON}}}');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse pmessage from channel "ch:1"'),
      );
    });
  });

  // ── Constructor with env vars ─────────────────────────────────────────────────

  describe('constructor with env vars', () => {
    it('uses REDIS_PORT from environment when set', () => {
      process.env['REDIS_PORT'] = '6380';
      vi.clearAllMocks();
      (Redis as any).__instances = [];
      new PubSubService();
      const opts = (Redis as any).mock.calls.at(-1)?.[0] as any;
      expect(opts.port).toBe(6380);
      delete process.env['REDIS_PORT'];
    });
  });

  // ── Constructor retryStrategy ─────────────────────────────────────────────────

  describe('constructor retryStrategy', () => {
    it('returns capped delay based on retry count', () => {
      const opts = (Redis as any).mock.calls.at(-1)?.[0] as any;
      const retryStrategy = opts?.retryStrategy;
      expect(retryStrategy).toBeDefined();
      expect(retryStrategy(1)).toBe(50);    // 1 * 50 = 50 ms
      expect(retryStrategy(20)).toBe(1000); // 20 * 50 = 1000 ms (< 2000)
      expect(retryStrategy(50)).toBe(2000); // 50 * 50 = 2500 → capped at 2000
    });
  });
});
