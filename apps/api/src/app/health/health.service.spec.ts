import { HealthService } from './health.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { StripeService } from '@libs/billing';
import { vi } from 'vitest';

const mockPrisma = {
  $queryRaw: vi.fn(),
} as unknown as PrismaBusinessService;

const mockRedisClient = { ping: vi.fn() };
const mockCacheService = {
  getClient: vi.fn().mockReturnValue(mockRedisClient),
} as unknown as CacheService;

const mockStripeService = {
  checkConnectivity: vi.fn(),
} as unknown as StripeService;

describe('HealthService', () => {
  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheService.getClient = vi.fn().mockReturnValue(mockRedisClient);
    (
      mockStripeService.checkConnectivity as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ status: 'ok', responseTime: 10 });
    service = new HealthService(
      mockPrisma,
      mockCacheService,
      mockStripeService,
    );
  });

  // -----------------------------------------------------------------------
  // checkDatabase (tested indirectly via checkHealth + checkReadiness)
  // -----------------------------------------------------------------------
  describe('checkHealth', () => {
    it('returns status "ok" when all services are healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

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

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.redis.status).toBe('error');
    });

    it('delegates Stripe check to stripeService.checkConnectivity', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      (
        mockStripeService.checkConnectivity as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ status: 'misconfigured' });

      const result = await service.checkHealth();

      expect(result.status).toBe('degraded');
      expect(result.services.stripe.status).toBe('misconfigured');
      expect(mockStripeService.checkConnectivity).toHaveBeenCalledTimes(1);
    });

    it('returns stripe status from checkConnectivity result', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      (
        mockStripeService.checkConnectivity as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ status: 'error' });

      const result = await service.checkHealth();

      expect(result.services.stripe.status).toBe('error');
    });

    it('includes responseTime for stripe when provided by checkConnectivity', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');
      (
        mockStripeService.checkConnectivity as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ status: 'ok', responseTime: 42 });

      const result = await service.checkHealth();

      expect(result.services.stripe.responseTime).toBe(42);
    });

    it('includes responseTime for database when healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      const result = await service.checkHealth();

      expect(typeof result.services.database.responseTime).toBe('number');
      expect(result.services.database.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('includes responseTime for redis when healthy', async () => {
      mockPrisma.$queryRaw = vi.fn().mockResolvedValue([]);
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

      const result = await service.checkHealth();

      expect(typeof result.services.redis.responseTime).toBe('number');
    });

    it('omits responseTime for database when it throws', async () => {
      mockPrisma.$queryRaw = vi.fn().mockRejectedValue(new Error('down'));
      mockRedisClient.ping = vi.fn().mockResolvedValue('PONG');

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
      mockRedisClient.ping = vi.fn().mockRejectedValue(new Error('Redis down'));

      expect(await service.checkReadiness()).toBe(false);
    });

    it('returns false (does not throw) when an unexpected error occurs', async () => {
      // Simulate a top-level error inside checkReadiness
      vi.spyOn(service as any, 'checkDatabase').mockRejectedValue(
        new Error('Unexpected crash'),
      );

      expect(await service.checkReadiness()).toBe(false);
    });
  });
});

