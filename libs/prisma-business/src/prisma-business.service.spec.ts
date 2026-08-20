// Mock the generated Prisma client and adapter so no real DB connection is made.
// Tenant-scoped model delegates are stubbed with a `findMany` so
// wrapTenantScopedDelegates() (called from onModuleInit) has a real object
// to wrap instead of hitting its "no delegate found" skip path.
const TENANT_MODEL_STUBS = [
  'organization',
  'membership',
  'file',
  'job',
  'orgExport',
  'notification',
  'entitlementOverride',
  'billingEvent',
  'subscriptionSnapshot',
  'event',
  'eventAttendee',
  'eventOccurrenceAttendee',
  'eventException',
  'activityLog',
];

vi.mock('./generated/prisma/client.js', () => {
  class PrismaClient {
    $connect = vi.fn().mockResolvedValue(undefined);
    $disconnect = vi.fn().mockResolvedValue(undefined);
    $on = vi.fn();
    $executeRaw = vi.fn().mockResolvedValue(undefined);
    $transaction: (fn: (tx: unknown) => unknown) => unknown;

    constructor() {
      // Mirrors real Prisma semantics: the `tx` handed to a $transaction
      // callback is a *separate*, unwrapped client — distinct from `this`
      // (which prisma-business.service.ts mutates in place via
      // wrapTenantScopedDelegates). Reusing `this` as `tx` here would make
      // the mock call back into the wrapped Proxy and recurse forever.
      const rawTx: Record<string, unknown> = { $executeRaw: this.$executeRaw };
      for (const model of TENANT_MODEL_STUBS) {
        const delegate = {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        };
        (this as unknown as Record<string, unknown>)[model] = delegate;
        rawTx[model] = delegate;
      }
      this.$transaction = vi.fn(async (fn) => fn(rawTx));
    }
  }
  return { PrismaClient };
});
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class PrismaPg {},
}));

import { ConfigService } from '@nestjs/config';
import { PrismaBusinessService } from './prisma-business.service';
import { runWithTenant } from './tenant-context';
import { vi } from 'vitest';

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

  describe('tenant-scoped delegate wrapping (RLS)', () => {
    it('opens a transaction and sets app.current_org_id from the tenant context before delegating', async () => {
      await service.onModuleInit();

      await runWithTenant('org-a', () => (service as any).job.findMany({}));

      expect((service as any)['$transaction']).toHaveBeenCalledTimes(1);
      // One set_config call each for org_id, user_id, system_lookup.
      expect((service as any)['$executeRaw']).toHaveBeenCalledTimes(3);
      const executeRawCall = (service as any)['$executeRaw'].mock.calls[0];
      // Tagged-template call: [stringsArray, ...values] — orgId is the only value.
      expect(executeRawCall[1]).toBe('org-a');
    });

    it('sets a null org context when called outside runWithTenant (fails RLS closed)', async () => {
      await service.onModuleInit();

      await (service as any).job.findMany({});

      const executeRawCall = (service as any)['$executeRaw'].mock.calls[0];
      expect(executeRawCall[1]).toBeNull();
    });

    it('does not affect non-model methods like $connect/$disconnect', async () => {
      await service.onModuleInit();
      expect(typeof (service as any).$transaction).toBe('function');
      expect(typeof (service as any).$disconnect).toBe('function');
    });
  });
});
