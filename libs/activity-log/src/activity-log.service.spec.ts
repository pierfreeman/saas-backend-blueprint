import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogService } from './activity-log.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { vi } from 'vitest';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const ACTOR_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';
const ENTITY_UUID = 'c3d4e5f6-a7b8-4901-cd23-ef4567ab8901';

function buildPrismaMock() {
  return {
    activityLog: {
      create: vi.fn().mockResolvedValue({ id: 'some-id' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function makeLog(overrides = {}) {
  return {
    id: 'some-id',
    orgId: ORG_UUID,
    actorId: ACTOR_UUID,
    actorRole: 'OWNER',
    action: 'org.created',
    entityType: 'Organization',
    entityId: ENTITY_UUID,
    metadata: {},
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('ActivityLogService', () => {
  let service: ActivityLogService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityLogService,
        { provide: PrismaBusinessService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ActivityLogService>(ActivityLogService);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── logActivity ────────────────────────────────────────────────────────────

  describe('logActivity', () => {
    it('persists a record via prisma.activityLog.create', async () => {
      service.logActivity({
        orgId: ORG_UUID,
        actorId: ACTOR_UUID,
        actorRole: 'OWNER',
        action: 'org.created',
        entityType: 'Organization',
        entityId: ENTITY_UUID,
        metadata: { name: 'Acme' },
      });

      // Allow the micro-task queue to flush
      await new Promise(process.nextTick);

      expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
      const data = prisma.activityLog.create.mock.calls[0][0].data;
      expect(data.orgId).toBe(ORG_UUID);
      expect(data.action).toBe('org.created');
      expect(data.metadata).toEqual({ name: 'Acme' });
    });

    it('does not throw when prisma.activityLog.create rejects (fire-and-forget)', async () => {
      prisma.activityLog.create.mockRejectedValueOnce(new Error('DB down'));
      const loggerSpy = vi
        .spyOn(service.logger, 'error')
        .mockImplementation(() => undefined);

      expect(() =>
        service.logActivity({ orgId: ORG_UUID, action: 'org.updated' }),
      ).not.toThrow();

      await new Promise(process.nextTick);

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('skips write and warns when orgId is not a valid UUID', async () => {
      const warnSpy = vi
        .spyOn(service.logger, 'warn')
        .mockImplementation(() => undefined);

      service.logActivity({ orgId: 'not-a-uuid', action: 'org.created' });
      await new Promise(process.nextTick);

      expect(prisma.activityLog.create).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('stores null fields when optional fields are omitted', async () => {
      service.logActivity({ orgId: ORG_UUID, action: 'org.created' });
      await new Promise(process.nextTick);

      const data = prisma.activityLog.create.mock.calls[0][0].data;
      expect(data.actorId).toBeNull();
      expect(data.actorRole).toBeNull();
      expect(data.entityType).toBeNull();
      expect(data.entityId).toBeNull();
      expect(data.metadata).toEqual({});
    });
  });

  // ─── findByOrg ──────────────────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns paginated results with default limit and offset', async () => {
      const log = makeLog();
      prisma.activityLog.findMany.mockResolvedValueOnce([log]);
      prisma.activityLog.count.mockResolvedValueOnce(1);

      const result = await service.findByOrg(ORG_UUID);

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
      expect(result.total).toBe(1);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].orgId).toBe(ORG_UUID);
    });

    it('respects custom limit and offset', async () => {
      prisma.activityLog.findMany.mockResolvedValueOnce([]);
      prisma.activityLog.count.mockResolvedValueOnce(50);

      const result = await service.findByOrg(ORG_UUID, { limit: 10, offset: 20 });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      const call = prisma.activityLog.findMany.mock.calls[0][0];
      expect(call.take).toBe(10);
      expect(call.skip).toBe(20);
    });

    it('applies action prefix filter when provided', async () => {
      prisma.activityLog.findMany.mockResolvedValueOnce([]);
      prisma.activityLog.count.mockResolvedValueOnce(0);

      await service.findByOrg(ORG_UUID, { action: 'org.' });

      const where = prisma.activityLog.findMany.mock.calls[0][0].where;
      expect(where.action).toEqual({ startsWith: 'org.' });
    });

    it('applies date range filter when provided', async () => {
      const fromDate = new Date('2026-01-01');
      const toDate = new Date('2026-12-31');
      prisma.activityLog.findMany.mockResolvedValueOnce([]);
      prisma.activityLog.count.mockResolvedValueOnce(0);

      await service.findByOrg(ORG_UUID, { fromDate, toDate });

      const where = prisma.activityLog.findMany.mock.calls[0][0].where;
      expect(where.createdAt).toEqual({ gte: fromDate, lte: toDate });
    });

    it('returns an empty logs array when no records exist', async () => {
      const result = await service.findByOrg(ORG_UUID);
      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ─── toNullableUuid ─────────────────────────────────────────────────────────

  describe('toNullableUuid', () => {
    it.each([
      [ORG_UUID, ORG_UUID],
      [ACTOR_UUID, ACTOR_UUID],
    ])('returns the UUID for valid input %s', (input, expected) => {
      expect(service.toNullableUuid(input)).toBe(expected);
    });

    it.each([
      ['not-a-uuid'],
      [''],
      ['   '],
      [null],
      [undefined],
      [123],
    ])('returns null for invalid input %p', (input) => {
      expect(service.toNullableUuid(input)).toBeNull();
    });
  });
});
