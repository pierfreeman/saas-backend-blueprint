import { Test, TestingModule } from '@nestjs/testing';
import { AdminActivityLogRepository } from './admin-activity-log.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeLog = (overrides = {}) => ({
  id: 'log-1',
  orgId: 'org-1',
  actorId: 'user-1',
  actorRole: 'ADMIN',
  action: 'membership.created',
  entityType: 'membership',
  entityId: 'mem-1',
  metadata: { foo: 'bar' },
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  activityLog: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminActivityLogRepository', () => {
  let repository: AdminActivityLogRepository;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminActivityLogRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(AdminActivityLogRepository);
  });

  // ── findAll — base cases ──────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated logs with defaults when no filters provided', async () => {
      const log = makeLog();
      mockPrisma.activityLog.findMany.mockResolvedValue([log]);
      mockPrisma.activityLog.count.mockResolvedValue(1);

      const result = await repository.findAll({});

      expect(result.total).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(100);
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]).toMatchObject({
        id: 'log-1',
        orgId: 'org-1',
        actorId: 'user-1',
        action: 'membership.created',
      });
    });

    it('passes limit and offset to prisma', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      await repository.findAll({ limit: 20, offset: 40 });

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, skip: 40 }),
      );
    });

    it('caps limit at MAX_LIMIT (500)', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      const result = await repository.findAll({ limit: 9999 });

      expect(result.limit).toBe(500);
      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 500 }),
      );
    });

    it('scopes query to orgId when provided', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      await repository.findAll({ orgId: 'org-42' });

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-42' }),
        }),
      );
    });

    it('does not include orgId filter when orgId is omitted', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      await repository.findAll({});

      const call = mockPrisma.activityLog.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('orgId');
    });

    it('filters by action prefix when action is provided', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      await repository.findAll({ action: 'membership.' });

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { startsWith: 'membership.' },
          }),
        }),
      );
    });

    it('applies date range filter when fromDate and toDate are provided', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      const from = new Date('2024-01-01');
      const to = new Date('2024-12-31');

      await repository.findAll({ fromDate: from, toDate: to });

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: from, lte: to },
          }),
        }),
      );
    });

    it('applies date range when only fromDate is provided', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      const from = new Date('2024-06-01');

      await repository.findAll({ fromDate: from });

      expect(mockPrisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: from, lte: undefined },
          }),
        }),
      );
    });

    it('maps all fields from ActivityLog to ActivityLogRecord', async () => {
      const log = makeLog();
      mockPrisma.activityLog.findMany.mockResolvedValue([log]);
      mockPrisma.activityLog.count.mockResolvedValue(1);

      const result = await repository.findAll({});

      expect(result.logs[0]).toEqual({
        id: log.id,
        orgId: log.orgId,
        actorId: log.actorId,
        actorRole: log.actorRole,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        createdAt: log.createdAt,
      });
    });

    it('returns empty logs array when no records found', async () => {
      mockPrisma.activityLog.findMany.mockResolvedValue([]);
      mockPrisma.activityLog.count.mockResolvedValue(0);

      const result = await repository.findAll({});

      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
    });
  });
});
