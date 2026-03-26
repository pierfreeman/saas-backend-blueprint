import { BruteForceService } from './brute-force.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Mock, vi } from 'vitest';

// ─── Redis stub ──────────────────────────────────────────────────────────────

function makeRedisStub() {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();

  return {
    store,
    exists: vi.fn(async (...keys: string[]) => {
      return keys.filter((k) => store.has(k)).length;
    }),
    incr: vi.fn(async (key: string) => {
      const val = Number.parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, String(val));
      return val;
    }),
    expire: vi.fn(async (key: string, ttl: number) => {
      ttls.set(key, ttl);
      return 1;
    }),
    set: vi.fn(
      async (key: string, val: string, _ex: string, _ttl: number) => {
        store.set(key, val);
        ttls.set(key, _ttl);
        return 'OK';
      },
    ),
    del: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
        ttls.delete(k);
      }
      return count;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    ttl: vi.fn(
      async (key: string) => ttls.get(key) ?? /* -2 = key does not exist */ -2,
    ),
    quit: vi.fn(async () => 'OK'),
    on: vi.fn(),
  };
}

describe('BruteForceService', () => {
  let service: BruteForceService;
  let redis: ReturnType<typeof makeRedisStub>;

  beforeEach(async () => {
    redis = makeRedisStub();

    const module = await Test.createTestingModule({
      providers: [
        BruteForceService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, unknown> = {
                'security.bruteForce.maxAttempts': 3,
                'security.bruteForce.lockoutTtl': 900,
                'security.bruteForce.trackingTtl': 3600,
                'redis.host': 'localhost',
                'redis.port': 6379,
                'redis.password': undefined,
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    service = module.get(BruteForceService);
    service.onModuleInit();
    (service as unknown as { client: unknown })['client'] = redis;
  });

  afterEach(() => vi.clearAllMocks());

  describe('recordFailedAttempt', () => {
    it('increments the attempt counter', async () => {
      const result = await service.recordFailedAttempt('ip:1.2.3.4');
      expect(result.locked).toBe(false);
      expect(result.attempts).toBe(1);
    });

    it('locks after reaching maxAttempts', async () => {
      await service.recordFailedAttempt('ip:1.2.3.4');
      await service.recordFailedAttempt('ip:1.2.3.4');
      const result = await service.recordFailedAttempt('ip:1.2.3.4');
      expect(result.locked).toBe(true);
      expect(result.attempts).toBe(3);
    });

    it('sets lockout TTL on the lock key', async () => {
      await service.recordFailedAttempt('ip:1.2.3.4');
      await service.recordFailedAttempt('ip:1.2.3.4');
      await service.recordFailedAttempt('ip:1.2.3.4');
      expect(redis.set).toHaveBeenCalledWith(
        'bf:lock:ip:1.2.3.4',
        '1',
        'EX',
        900,
      );
    });

    it('returns locked=true immediately when already locked', async () => {
      // Pre-set the lock
      redis.store.set('bf:lock:ip:1.2.3.4', '1');
      redis.store.set('bf:attempts:ip:1.2.3.4', '3');

      const result = await service.recordFailedAttempt('ip:1.2.3.4');
      expect(result.locked).toBe(true);
      // Should NOT have called incr (counter shouldn't advance past max)
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  describe('isLocked', () => {
    it('returns false when no lock exists', async () => {
      expect(await service.isLocked('ip:1.2.3.4')).toBe(false);
    });

    it('returns true when lock key exists', async () => {
      redis.store.set('bf:lock:ip:1.2.3.4', '1');
      expect(await service.isLocked('ip:1.2.3.4')).toBe(true);
    });
  });

  describe('resetAttempts', () => {
    it('removes both attempt counter and lock key', async () => {
      redis.store.set('bf:attempts:ip:1.2.3.4', '3');
      redis.store.set('bf:lock:ip:1.2.3.4', '1');

      await service.resetAttempts('ip:1.2.3.4');

      expect(redis.del).toHaveBeenCalledWith(
        'bf:attempts:ip:1.2.3.4',
        'bf:lock:ip:1.2.3.4',
      );
      expect(redis.store.has('bf:lock:ip:1.2.3.4')).toBe(false);
    });
  });

  describe('getState', () => {
    it('returns zero state when no previous attempts', async () => {
      const state = await service.getState('ip:5.5.5.5');
      expect(state.locked).toBe(false);
      expect(state.attempts).toBe(0);
      expect(state.lockoutRemainingSeconds).toBe(0);
    });

    it('reports locked state correctly', async () => {
      redis.store.set('bf:lock:ip:1.2.3.4', '1');
      redis.store.set('bf:attempts:ip:1.2.3.4', '3');
      redis.ttl.mockResolvedValueOnce(700); // mock remaining TTL

      const state = await service.getState('ip:1.2.3.4');
      expect(state.locked).toBe(true);
      expect(state.attempts).toBe(3);
      expect(state.lockoutRemainingSeconds).toBe(700);
    });
  });

  describe('fail-open behaviour', () => {
    it('returns locked=false when Redis throws on isLocked', async () => {
      (redis.exists as Mock).mockRejectedValueOnce(
        new Error('Redis unavailable'),
      );
      expect(await service.isLocked('ip:1.2.3.4')).toBe(false);
    });

    it('returns locked=false when Redis throws on recordFailedAttempt', async () => {
      (redis.exists as Mock).mockRejectedValueOnce(
        new Error('Redis unavailable'),
      );
      const result = await service.recordFailedAttempt('ip:x');
      expect(result.locked).toBe(false);
    });
  });
});
