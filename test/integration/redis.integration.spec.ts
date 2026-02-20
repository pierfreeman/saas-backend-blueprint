import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../src/redis/redis.service';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';
import { OrganizationEntitlements } from '../../src/modules/feature-flags/interfaces/entitlements.interface';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Redis Integration Tests', () => {
  let module: TestingModule;
  let redisService: RedisService;
  let featureFlagsService: FeatureFlagsService;
  let prisma: any;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        RedisService,
        FeatureFlagsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, any> = {
                'redis.host': process.env.REDIS_HOST || 'localhost',
                'redis.port': parseInt(process.env.REDIS_PORT || '6379', 10),
                'redis.password': process.env.REDIS_PASSWORD || '',
              };
              return config[key];
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            subscription: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    redisService = module.get<RedisService>(RedisService);
    featureFlagsService = module.get<FeatureFlagsService>(FeatureFlagsService);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    // Flush Redis before each test
    await redisService.getClient().flushdb();
  });

  describe('Basic Redis Operations', () => {
    it('should set and get a value', async () => {
      await redisService.set('test-key', 'test-value');

      const value = await redisService.get('test-key');

      expect(value).toBe('test-value');
    });

    it('should set value with TTL', async () => {
      await redisService.set('ttl-key', 'ttl-value', 1); // 1 second TTL

      const value = await redisService.get('ttl-key');
      expect(value).toBe('ttl-value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const expiredValue = await redisService.get('ttl-key');
      expect(expiredValue).toBeNull();
    });

    it('should delete a key', async () => {
      await redisService.set('delete-key', 'to-delete');

      await redisService.del('delete-key');

      const value = await redisService.get('delete-key');
      expect(value).toBeNull();
    });

    it('should delete keys by pattern', async () => {
      await redisService.set('prefix:key1', 'value1');
      await redisService.set('prefix:key2', 'value2');
      await redisService.set('other:key3', 'value3');

      // Delete by pattern using keys + del
      const keysToDelete = await redisService.keys('prefix:*');
      for (const key of keysToDelete) {
        await redisService.del(key);
      }

      const value1 = await redisService.get('prefix:key1');
      const value2 = await redisService.get('prefix:key2');
      const value3 = await redisService.get('other:key3');

      expect(value1).toBeNull();
      expect(value2).toBeNull();
      expect(value3).toBe('value3'); // Not deleted
    });
  });

  describe('Entitlements Caching', () => {
    const orgId = 'org-redis-test';

    it('should cache entitlements', async () => {
      const _entitlements: OrganizationEntitlements = {
        organizationId: orgId,
        plan: 'PRO',
        subscriptionStatus: 'ACTIVE',
        maxTeams: 10,
        maxPlayers: 200,
        maxCoaches: 10,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: false,
        prioritySupport: false,
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValue({
        id: 'sub-123',
        orgId,
        stripeSubscriptionId: 'sub_stripe',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // First call - should hit DB and cache
      const result1 = await featureFlagsService.getEntitlements(orgId);

      // Second call - should hit cache
      const result2 = await featureFlagsService.getEntitlements(orgId);

      expect(result1).toEqual(result2);
      expect(prisma.subscription.findUnique).toHaveBeenCalledTimes(1); // Only once
    });

    it('should invalidate entitlements cache', async () => {
      const _entitlements: OrganizationEntitlements = {
        organizationId: orgId,
        plan: 'FREE',
        subscriptionStatus: 'ACTIVE',
        maxTeams: 2,
        maxPlayers: 20,
        maxCoaches: 2,
        advancedAnalytics: false,
        customReports: false,
        apiAccess: false,
        ssoEnabled: false,
        prioritySupport: false,
      };

      (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce(null);

      // Cache entitlements
      await featureFlagsService.getEntitlements(orgId);

      // Verify cached
      const cachedKey = `entitlements:${orgId}`;
      const cached = await redisService.get(cachedKey);
      expect(cached).not.toBeNull();

      // Invalidate
      await featureFlagsService.invalidateEntitlements(orgId);

      // Verify deleted
      const afterInvalidation = await redisService.get(cachedKey);
      expect(afterInvalidation).toBeNull();
    });
  });

  describe('Rate Limiting Support', () => {
    it('should increment counter', async () => {
      const key = 'rate-limit:user-123';

      const count1 = await redisService.incr(key);
      const count2 = await redisService.incr(key);
      const count3 = await redisService.incr(key);

      expect(count1).toBe(1);
      expect(count2).toBe(2);
      expect(count3).toBe(3);
    });

    it('should set expiration on rate limit key', async () => {
      const key = 'rate-limit:user-456';

      await redisService.incr(key);
      await redisService.expire(key, 1); // 1 second

      const ttl = await redisService.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1);
    });

    it('should handle rate limiting scenario', async () => {
      const userId = 'user-789';
      const window = 60; // 60 seconds
      const limit = 10;

      const key = `rate-limit:${userId}`;

      // Simulate 10 requests (at limit)
      for (let i = 0; i < limit; i++) {
        await redisService.incr(key);
      }

      if ((await redisService.ttl(key)) === -1) {
        await redisService.expire(key, window);
      }

      const count = parseInt((await redisService.get(key)) || '0', 10);

      // 11th request should be blocked
      if (count >= limit) {
        expect(count).toBeGreaterThanOrEqual(limit);
      } else {
        await redisService.incr(key);
      }

      const finalCount = parseInt((await redisService.get(key)) || '0', 10);
      expect(finalCount).toBe(limit); // Should not exceed
    });
  });

  describe('Session/Token Storage', () => {
    it('should store and retrieve session data', async () => {
      const sessionId = 'session-abc123';
      const sessionData = {
        userId: 'user-123',
        orgId: 'org-456',
        role: 'ADMIN',
        createdAt: new Date().toISOString(),
      };

      await redisService.set(`session:${sessionId}`, JSON.stringify(sessionData), 3600); // 1 hour

      const retrieved = await redisService.get(`session:${sessionId}`);
      const parsed = JSON.parse(retrieved!);

      expect(parsed.userId).toBe(sessionData.userId);
      expect(parsed.orgId).toBe(sessionData.orgId);
      expect(parsed.role).toBe(sessionData.role);
    });

    it('should handle session expiration', async () => {
      const sessionId = 'session-xyz789';
      const sessionData = { userId: 'user-999' };

      await redisService.set(`session:${sessionId}`, JSON.stringify(sessionData), 1); // 1 second

      // Verify exists
      const exists = await redisService.get(`session:${sessionId}`);
      expect(exists).not.toBeNull();

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const expired = await redisService.get(`session:${sessionId}`);
      expect(expired).toBeNull();
    });
  });

  describe('Cache Invalidation Patterns', () => {
    it('should invalidate all organization-related caches', async () => {
      const orgId = 'org-multi-cache';

      // Set multiple cache keys for org
      await redisService.set(`entitlements:${orgId}`, 'cached-entitlements');
      await redisService.set(`org:${orgId}:teams`, 'cached-teams');
      await redisService.set(`org:${orgId}:players`, 'cached-players');
      await redisService.set(`other-key`, 'should-remain');

      // Invalidate all org caches using keys + del
      const keysToDelete = await redisService.keys(`*${orgId}*`);
      for (const key of keysToDelete) {
        await redisService.del(key);
      }

      const entitlements = await redisService.get(`entitlements:${orgId}`);
      const teams = await redisService.get(`org:${orgId}:teams`);
      const players = await redisService.get(`org:${orgId}:players`);
      const other = await redisService.get('other-key');

      expect(entitlements).toBeNull();
      expect(teams).toBeNull();
      expect(players).toBeNull();
      expect(other).toBe('should-remain');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await redisService.set('invalid-json', 'not-a-json-string');

      const value = await redisService.get('invalid-json');
      expect(value).toBe('not-a-json-string');

      // Trying to parse manually should fail, but get() should work
      expect(() => JSON.parse(value!)).toThrow();
    });

    it('should return null for non-existent keys', async () => {
      const value = await redisService.get('non-existent-key');
      expect(value).toBeNull();
    });
  });
});
