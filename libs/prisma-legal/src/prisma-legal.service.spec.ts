// Mock @prisma/legal-client so no real DB engine is loaded and no connections are made.
jest.mock('@prisma/legal-client', () => {
  class PrismaClient {
    $connect = jest.fn().mockResolvedValue(undefined);
    $disconnect = jest.fn().mockResolvedValue(undefined);
    $on = jest.fn();
  }
  return { PrismaClient };
});

import { ConfigService } from '@nestjs/config';
import { PrismaLegalService } from './prisma-legal.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string) => overrides[key] ?? undefined,
  } as unknown as ConfigService;
}

describe('PrismaLegalService', () => {
  let service: PrismaLegalService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrismaLegalService(
      makeConfig({ 'database.legalAuditUrl': 'postgresql://legal-test' }),
    );
  });

  describe('onModuleInit', () => {
    it('connects to the legal audit database successfully', async () => {
      await expect(service.onModuleInit()).resolves.not.toThrow();
      expect((service as any)['$connect']).toHaveBeenCalledTimes(1);
    });

    it('re-throws when $connect fails', async () => {
      (service as any)['$connect'].mockRejectedValueOnce(
        new Error('Legal DB unreachable'),
      );
      await expect(service.onModuleInit()).rejects.toThrow('Legal DB unreachable');
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects from the legal audit database', async () => {
      await service.onModuleDestroy();
      expect((service as any)['$disconnect']).toHaveBeenCalledTimes(1);
    });
  });

  describe('append-only contract', () => {
    it('has no cleanDatabase method', () => {
      expect((service as any).cleanDatabase).toBeUndefined();
    });
  });
});
