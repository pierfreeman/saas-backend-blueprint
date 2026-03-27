import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { vi } from 'vitest';

const mockHealthService = {
  checkHealth: vi.fn(),
  checkReadiness: vi.fn(),
} as unknown as HealthService;

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new HealthController(mockHealthService);
  });

  describe('check()', () => {
    it('returns the full health report from HealthService', async () => {
      const report = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: { status: 'ok', responseTime: 5 },
          redis: { status: 'ok', responseTime: 2 },
        },
      };
      mockHealthService.checkHealth = vi.fn().mockResolvedValue(report);

      const result = await controller.check();
      expect(result).toBe(report);
      expect(mockHealthService.checkHealth).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from HealthService', async () => {
      mockHealthService.checkHealth = vi
        .fn()
        .mockRejectedValue(new Error('Health check failed'));

      await expect(controller.check()).rejects.toThrow('Health check failed');
    });
  });

  describe('liveness()', () => {
    it('returns { status: "ok" } without calling any service', () => {
      const result = controller.liveness();
      expect(result).toEqual({ status: 'ok' });
      expect(mockHealthService.checkHealth).not.toHaveBeenCalled();
      expect(mockHealthService.checkReadiness).not.toHaveBeenCalled();
    });
  });

  describe('readiness()', () => {
    it('returns { status: "ok", ready: true } when all services are ready', async () => {
      mockHealthService.checkReadiness = vi.fn().mockResolvedValue(true);

      const result = await controller.readiness();
      expect(result).toEqual({ status: 'ok', ready: true });
      expect(mockHealthService.checkReadiness).toHaveBeenCalledTimes(1);
    });

    it('returns { status: "not ready", ready: false } when a service is down', async () => {
      mockHealthService.checkReadiness = vi.fn().mockResolvedValue(false);

      const result = await controller.readiness();
      expect(result).toEqual({ status: 'not ready', ready: false });
    });

    it('propagates unexpected errors from checkReadiness', async () => {
      mockHealthService.checkReadiness = vi
        .fn()
        .mockRejectedValue(new Error('Redis unavailable'));

      await expect(controller.readiness()).rejects.toThrow('Redis unavailable');
    });
  });
});
