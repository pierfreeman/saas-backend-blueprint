// Factory mock — must be declared before any imports use ioredis.
// The constructor returns a shared instance; tests reconfigure methods per-test
// using mockResolvedValueOnce / mockRejectedValueOnce.
vi.mock('ioredis', () => {
  const instance = {
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
    keys: vi.fn().mockResolvedValue([]),
    flushdb: vi.fn().mockResolvedValue('OK'),
  };
  const Ctor: any = vi.fn(function (this: any) {
    return instance;
  });
  Ctor.__instance = instance;
  return { __esModule: true, default: Ctor };
});

import Redis from 'ioredis';
import { CacheService } from './cache.service';
import { vi } from 'vitest';

// Access the shared mock client injected by the factory above
const mockClient: any = (Redis as any).__instance;

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CacheService();
  });

  afterEach(() => {
    delete process.env['NODE_ENV'];
  });

  describe('get', () => {
    it('returns parsed value when key exists', async () => {
      mockClient.get.mockResolvedValueOnce(JSON.stringify({ name: 'test' }));
      const result = await service.get<{ name: string }>('my-key');
      expect(result).toEqual({ name: 'test' });
      expect(mockClient.get).toHaveBeenCalledWith('my-key');
    });

    it('returns null when key is missing', async () => {
      mockClient.get.mockResolvedValueOnce(null);
      expect(await service.get('missing')).toBeNull();
    });

    it('returns null and does not throw on Redis error', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.get('key')).resolves.toBeNull();
    });
  });

  describe('set', () => {
    it('calls setex when TTL is provided', async () => {
      await service.set('k', { v: 1 }, 300);
      expect(mockClient.setex).toHaveBeenCalledWith(
        'k',
        300,
        JSON.stringify({ v: 1 }),
      );
    });

    it('calls set without TTL when no TTL is provided', async () => {
      await service.set('k', 42);
      expect(mockClient.set).toHaveBeenCalledWith('k', JSON.stringify(42));
    });
  });

  describe('del', () => {
    it('calls del on the Redis client', async () => {
      await service.del('k');
      expect(mockClient.del).toHaveBeenCalledWith('k');
    });
  });

  describe('exists', () => {
    it('delegates to the Redis client', async () => {
      mockClient.exists.mockResolvedValueOnce(1);
      expect(await service.exists('k')).toBe(1);
    });
  });

  describe('flushdb', () => {
    it('throws in production', async () => {
      process.env['NODE_ENV'] = 'production';
      await expect(service.flushdb()).rejects.toThrow(
        'Cannot flush Redis in production',
      );
    });

    it('flushes the DB outside production', async () => {
      process.env['NODE_ENV'] = 'test';
      await service.flushdb();
      expect(mockClient.flushdb).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('registers connect, error, and ready event listeners', async () => {
      await service.onModuleInit();
      const events = mockClient.on.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain('connect');
      expect(events).toContain('error');
      expect(events).toContain('ready');
    });

    it('invokes the connect callback without throwing', async () => {
      await service.onModuleInit();
      const connectCb = mockClient.on.mock.calls.find(
        (c: any[]) => c[0] === 'connect',
      )?.[1];
      expect(() => connectCb()).not.toThrow();
    });

    it('invokes the error callback without throwing', async () => {
      await service.onModuleInit();
      const errorCb = mockClient.on.mock.calls.find(
        (c: any[]) => c[0] === 'error',
      )?.[1];
      expect(() => errorCb(new Error('boom'))).not.toThrow();
    });

    it('invokes the ready callback without throwing', async () => {
      await service.onModuleInit();
      const readyCb = mockClient.on.mock.calls.find(
        (c: any[]) => c[0] === 'ready',
      )?.[1];
      expect(() => readyCb()).not.toThrow();
    });
  });

  describe('onModuleDestroy', () => {
    it('calls quit on the Redis client', async () => {
      await service.onModuleDestroy();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
    });
  });

  describe('getClient', () => {
    it('returns the underlying Redis client instance', () => {
      expect(service.getClient()).toBe(mockClient);
    });
  });

  describe('set — error path', () => {
    it('swallows the error and does not throw', async () => {
      mockClient.set.mockRejectedValueOnce(new Error('write error'));
      await expect(service.set('k', 'v')).resolves.toBeUndefined();
    });

    it('swallows the error when setex fails', async () => {
      mockClient.setex.mockRejectedValueOnce(new Error('write error'));
      await expect(service.set('k', 'v', 60)).resolves.toBeUndefined();
    });
  });

  describe('del — error path', () => {
    it('swallows the error and does not throw', async () => {
      mockClient.del.mockRejectedValueOnce(new Error('del error'));
      await expect(service.del('k')).resolves.toBeUndefined();
    });
  });

  describe('incr', () => {
    it('delegates to the Redis client and returns the new value', async () => {
      mockClient.incr.mockResolvedValueOnce(5);
      expect(await service.incr('counter')).toBe(5);
      expect(mockClient.incr).toHaveBeenCalledWith('counter');
    });
  });

  describe('expire', () => {
    it('delegates to the Redis client and returns 1 on success', async () => {
      mockClient.expire.mockResolvedValueOnce(1);
      expect(await service.expire('k', 120)).toBe(1);
      expect(mockClient.expire).toHaveBeenCalledWith('k', 120);
    });
  });

  describe('ttl', () => {
    it('delegates to the Redis client and returns remaining seconds', async () => {
      mockClient.ttl.mockResolvedValueOnce(42);
      expect(await service.ttl('k')).toBe(42);
      expect(mockClient.ttl).toHaveBeenCalledWith('k');
    });
  });

  describe('keys', () => {
    it('delegates to the Redis client and returns matching keys', async () => {
      mockClient.keys.mockResolvedValueOnce(['a:1', 'a:2']);
      expect(await service.keys('a:*')).toEqual(['a:1', 'a:2']);
      expect(mockClient.keys).toHaveBeenCalledWith('a:*');
    });
  });

  describe('deleteByPattern', () => {
    it('returns 0 immediately when no keys match', async () => {
      const result = await service.deleteByPattern('nonexistent:*');
      expect(result).toBe(0);
      expect(mockClient.del).not.toHaveBeenCalled();
    });

    it('deletes each matching key and returns the count', async () => {
      mockClient.keys.mockResolvedValueOnce(['k:1', 'k:2']);
      const result = await service.deleteByPattern('k:*');
      expect(result).toBe(2);
      expect(mockClient.del).toHaveBeenCalledTimes(2);
      expect(mockClient.del).toHaveBeenCalledWith('k:1');
      expect(mockClient.del).toHaveBeenCalledWith('k:2');
    });
  });

  describe('constructor retryStrategy', () => {
    it('returns capped delay based on retry count', () => {
      // retryStrategy is passed to the Redis constructor; retrieve it from
      // the options captured by the mock constructor call.
      const ctorOptions = (Redis as any).mock.calls.at(-1)?.[0] as any;
      const retryStrategy = ctorOptions?.retryStrategy;
      expect(retryStrategy).toBeDefined();
      expect(retryStrategy(1)).toBe(50); // 1 * 50 = 50ms
      expect(retryStrategy(20)).toBe(1000); // 20 * 50 = 1000ms (< 2000)
      expect(retryStrategy(50)).toBe(2000); // 50 * 50 = 2500 → capped at 2000
    });
  });
});
