import { HealthService } from './health.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { ConfigService } from '@nestjs/config';
import { StripeClient } from '@libs/billing';
import Stripe from 'stripe';
import { vi } from 'vitest';

const mockPrisma = {
  $queryRaw: vi.fn(),
} as unknown as PrismaBusinessService;

const mockRedisClient = { ping: vi.fn() };
const mockCacheService = {
  getClient: vi.fn().mockReturnValue(mockRedisClient),
} as unknown as CacheService;

const mockConfigService = {
  get: vi.fn(),
} as unknown as ConfigService;

const mockStripeAccounts = { retrieve: vi.fn() };
const mockStripeClient = {
  stripe: { accounts: mockStripeAccounts },
} as unknown as StripeClient;

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheService.getClient = vi.fn().mockReturnValue(mockRedisClient);
    service = new HealthService(
      mockPrisma,
      mockCacheService,
      mockConfigService,
      mockStripeClient,
    );
  });

  // -----------------------------------------------------------------------
  // checkDatabase (tested indirectly via checkHealth + checkReadiness)
  // -----------------------------------------------------------------------
  describe('checkHealth', () => {
    it('returns status "ok" when all services are healthy and Stripe key is valid', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc123');
      mockStripeAccounts.retrieve = vi
        .fn()
        .mockResolvedValue({ id: 'acct_test' });

      const result = await service.checkHealth();

      expect(result.status).toBe('ok');
      expect(result.services.database.status).toBe('ok');
      expect(result.services.redis.status).toBe('ok');
      expect(result.services.stripe.status).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
    });

    it('returns status "degraded" when the database is down', async () => {
      mockPrisma.$queryRaw = vi
        .fn()
        .mockRejectedValue(new Error('Connection refused'));
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.database.status).toBe('error');
      expect(result.services.redis.status).toBe('ok');
    });

    it('returns status "degraded" when Redis is down', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.status).toBe('error');
    });

    it('returns status "degraded" when Stripe key is missing', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue(undefined);

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.stripe.status).toBe('misconfigured');
      expect(mockStripeAccounts.retrieve).not.toHaveBeenCalled();
    });

    it('returns status "degraded" when Stripe key is malformed', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('invalid_key_format');

      const result = await service.checkHealth();

      expect(result.services.stripe.status).toBe('misconfigured');
      expect(mockStripeAccounts.retrieve).not.toHaveBeenCalled();
    });

    it('accepts sk_live_ prefix as valid Stripe key', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_live_xyz789');
      mockStripeAccounts.retrieve = vi
        .fn()
        .mockResolvedValue({ id: 'acct_live' });

      const result = await service.checkHealth();

      expect(result.services.stripe.status).toBe('ok');
      expect(mockStripeAccounts.retrieve).toHaveBeenCalledTimes(1);
    });

    it('returns stripe "misconfigured" when Stripe returns StripeAuthenticationError', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_bad_key');
      const authError = new Stripe.errors.StripeAuthenticationError({
        message: 'No such API key',
        type: 'invalid_request_error',
      } as never);
      mockStripeAccounts.retrieve = vi.fn().mockRejectedValue(authError);

      const result = await service.checkHealth();

      expect(result.services.stripe.status).toBe('misconfigured');
    });

    it('returns stripe "error" when Stripe throws a network error', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.checkHealth();

      expect(result.services.stripe.status).toBe('error');
    });

    it('includes responseTime for stripe when healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(typeof result.services.stripe.responseTime).toBe('number');
      expect(result.services.stripe.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('includes responseTime for database when healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(typeof result.services.database.responseTime).toBe('number');
      expect(result.services.database.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('includes responseTime for redis when healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(typeof result.services.redis.responseTime).toBe('number');
    });

    it('omits responseTime for database when it throws', async () => {
      mockPrisma.$queryRaw = vi.fn().mockRejectedValue(new Error('down'));
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc');
      mockStripeAccounts.retrieve = vi.fn().mockResolvedValue({});

      const result = await service.checkHealth();

      expect(result.services.database.responseTime).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // checkReadiness
  // -----------------------------------------------------------------------
  describe('checkReadiness', () => {
    it('returns true when both DB and Redis are healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      expect(await service.checkReadiness()).toBe(true);
    });

    it('returns false when DB is down', async () => {
      mockPrisma.$queryRaw = vi.fn().mockRejectedValue(new Error('DB error'));
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      expect(await service.checkReadiness()).toBe(false);
    });

    it('returns false when Redis is down', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi
        .fn()
        .mockRejectedValue(new Error('Redis down'));

      expect(await service.checkReadiness()).toBe(false);
    });

    it('returns false (does not throw) when an unexpected error occurs', async () => {
      // Simulate a top-level error inside checkReadiness
      vi
        .spyOn(service as any, 'checkDatabase')
        .mockRejectedValue(new Error('Unexpected crash'));

      expect(await service.checkReadiness()).toBe(false);
    });
  });
});
