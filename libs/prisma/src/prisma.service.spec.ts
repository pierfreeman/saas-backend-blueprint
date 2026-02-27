// Mock @prisma/client so no real DB engine is loaded and no connections are made.
jest.mock('@prisma/client', () => {
  class PrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
    $on = jest.fn();
  }
  return { PrismaClient };
});

import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrismaService(
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
      const prod = new PrismaService(
        makeConfig({ 'app.nodeEnv': 'production' }),
      );
      await expect(prod.cleanDatabase()).rejects.toThrow(
        'Cannot clean database in production',
      );
    });

    it('calls deleteMany on injected model accessors in non-production', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      (service as any)['user'] = { deleteMany };
      (service as any)['organization'] = { deleteMany };

      await service.cleanDatabase();

      expect(deleteMany).toHaveBeenCalledTimes(2);
    });
  });
});
