// Mock @prisma/client so no real DB engine is loaded and no connections are made.
vi.mock('@prisma/client', () => {
  class PrismaClient {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
    $on = vi.fn();
  }
  return { PrismaClient };
});

import { ConfigService } from '@nestjs/config';
import { PrismaBusinessService } from './prisma-business.service';
import { Mock, vi } from 'vitest';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('PrismaBusinessService', () => {
  let service: PrismaBusinessService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrismaBusinessService(
      makeConfig({ 'database.url': 'postgresql://test' }),
    );
  });

  describe('onModuleInit', () => {
    it('connects to the database successfully', async () => {
      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect((service as any)['$connect']).toHaveBeenCalledTimes(1);
    });

    it('re-throws when $connect fails', async () => {
      (service as any)['$connect'].mockRejectedValueOnce(
        new Error('DB unreachable'),
      );
      await expect(service.onModuleInit()).rejects.toThrow('DB unreachable');
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects from the database', async () => {
      await service.onModuleDestroy();
      expect((service as any)['$disconnect']).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanDatabase', () => {
    it('throws in production to prevent accidental data loss', async () => {
      const prod = new PrismaBusinessService(
        makeConfig({ 'app.nodeEnv': 'production' }),
      );
      await expect(prod.cleanDatabase()).rejects.toThrow(
        'Cannot clean database in production',
      );
    });

    it('calls deleteMany on injected model accessors in non-production', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
      (service as any)['orgExport'] = { deleteMany };
      (service as any)['activityLog'] = { deleteMany };
      (service as any)['billingEvent'] = { deleteMany };
      (service as any)['job'] = { deleteMany };
      (service as any)['membership'] = { deleteMany };
      (service as any)['organization'] = { deleteMany };
      (service as any)['user'] = { deleteMany };

      await service.cleanDatabase();

      expect(deleteMany).toHaveBeenCalledTimes(7);
    });
  });
});
