import { RateLimitService } from '../services/rate-limit.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRedisStub(counters: Map<string, number> = new Map()) {
  return {
    incr: jest.fn(async (key: string) => {
      const val = (counters.get(key) ?? 0) + 1;
      counters.set(key, val);
      return val;
    }),
    expire: jest.fn(async () => 1),
    quit: jest.fn(async () => 'OK'),
    on: jest.fn(),
  };
}

describe('RateLimitService', () => {
  let service: RateLimitService;
  let redisStub: ReturnType<typeof makeRedisStub>;
  const counters = new Map<string, number>();

  beforeEach(async () => {
    counters.clear();
    redisStub = makeRedisStub(counters);

    const module = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, unknown> = {
                'security.rateLimit.ttl': 60,
                'security.rateLimit.maxPerIp': 3, // low threshold for testing
                'security.rateLimit.maxPerUser': 5,
                'security.rateLimit.maxPerTenant': 10,
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

    service = module.get(RateLimitService);
    // Inject the stub Redis client
    service.onModuleInit();
    // Override the real Redis connection with our stub
    (service as unknown as { client: unknown })['client'] = redisStub;
  });

  afterEach(async () => {
    // Skip quit on test Redis stub
    jest.clearAllMocks();
  });

  describe('checkByIp', () => {
    it('allows the first request', async () => {
      const result = await service.checkByIp('1.2.3.4');
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
    });

    it('allows requests up to the threshold', async () => {
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');
      const result = await service.checkByIp('1.2.3.4');
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(3);
      expect(result.remaining).toBe(0);
    });

    it('blocks requests beyond the threshold', async () => {
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');
      const result = await service.checkByIp('1.2.3.4');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('uses separate counters for different IPs', async () => {
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');

      // Different IP should still be allowed
      const result = await service.checkByIp('9.9.9.9');
      expect(result.allowed).toBe(true);
    });

    it('sets TTL on first increment', async () => {
      await service.checkByIp('1.2.3.4');
      expect(redisStub.expire).toHaveBeenCalledTimes(1);
    });

    it('does not set TTL on subsequent increments', async () => {
      await service.checkByIp('1.2.3.4');
      await service.checkByIp('1.2.3.4');
      // expire should only be called once (on first increment)
      expect(redisStub.expire).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkByUser', () => {
    it('allows requests within user limit', async () => {
      const result = await service.checkByUser('user-abc');
      expect(result.allowed).toBe(true);
    });

    it('blocks requests exceeding user limit', async () => {
      for (let i = 0; i < 5; i++) await service.checkByUser('user-abc');
      const result = await service.checkByUser('user-abc');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkByTenant', () => {
    it('allows requests within tenant limit', async () => {
      const result = await service.checkByTenant('org-123');
      expect(result.allowed).toBe(true);
    });
  });

  describe('fail-open behaviour', () => {
    it('returns allowed=true when Redis throws', async () => {
      (redisStub.incr as jest.Mock).mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );
      const result = await service.checkByIp('1.2.3.4');
      expect(result.allowed).toBe(true);
    });
  });
});
