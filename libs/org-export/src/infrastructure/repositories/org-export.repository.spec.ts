import { vi } from 'vitest';
import {
  OrgExportRepository,
  CreateExportJobInput,
  CompleteExportInput,
  FailExportInput,
} from './org-export.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ExportStatus, JobStatus } from '@libs/prisma-business';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

function buildTx() {
  return {
    job: { create: vi.fn().mockResolvedValue({}) },
    orgExport: { create: vi.fn().mockResolvedValue({}) },
  };
}

function buildMockPrisma() {
  const tx = buildTx();
  return {
    organization: {
      findUnique: vi.fn(),
    },
    orgExport: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    job: {
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: vi.fn(),
    },
    membership: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    activityLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    file: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => Promise<void>) => {
      await cb(tx);
    }),
    __tx: tx,
  };
}

const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';
const JOB_UUID = 'd4e5f6a7-b8c9-6012-de34-fa5678bc9012';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';

function makeOrgExport(overrides = {}) {
  return {
    id: EXPORT_UUID,
    orgId: ORG_UUID,
    jobId: JOB_UUID,
    requestedByUserId: USER_UUID,
    status: ExportStatus.PENDING,
    fileUrl: null,
    fileSize: null,
    expiresAt: null,
    completedAt: null,
    failedAt: null,
    error: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OrgExportRepository', () => {
  let repo: OrgExportRepository;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    mockPrisma = buildMockPrisma();
    repo = new OrgExportRepository(
      mockPrisma as unknown as PrismaBusinessService,
    );
  });

  afterEach(() => vi.clearAllMocks());

  // ── findOrgById ────────────────────────────────────────────────────────────

  describe('findOrgById', () => {
    it('returns org summary when found', async () => {
      const org = { id: ORG_UUID, name: 'Acme', status: 'ACTIVE' };
      mockPrisma.organization.findUnique.mockResolvedValue(org);

      const result = await repo.findOrgById(ORG_UUID);

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_UUID },
        select: { id: true, name: true, status: true },
      });
      expect(result).toEqual(org);
    });

    it('returns null when not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      expect(await repo.findOrgById('unknown')).toBeNull();
    });
  });

  // ── findExportRecord ───────────────────────────────────────────────────────

  describe('findExportRecord', () => {
    it('returns export when found', async () => {
      const record = makeOrgExport();
      mockPrisma.orgExport.findUnique.mockResolvedValue(record);

      const result = await repo.findExportRecord(EXPORT_UUID);

      expect(mockPrisma.orgExport.findUnique).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID },
      });
      expect(result).toEqual(record);
    });

    it('returns null when not found', async () => {
      mockPrisma.orgExport.findUnique.mockResolvedValue(null);
      expect(await repo.findExportRecord('unknown')).toBeNull();
    });
  });

  // ── findExportByIdAndOrg ───────────────────────────────────────────────────

  describe('findExportByIdAndOrg', () => {
    it('returns export matching both id and orgId', async () => {
      const record = makeOrgExport();
      mockPrisma.orgExport.findFirst.mockResolvedValue(record);

      const result = await repo.findExportByIdAndOrg(EXPORT_UUID, ORG_UUID);

      expect(mockPrisma.orgExport.findFirst).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID, orgId: ORG_UUID },
      });
      expect(result).toEqual(record);
    });

    it('returns null when no match', async () => {
      mockPrisma.orgExport.findFirst.mockResolvedValue(null);
      expect(await repo.findExportByIdAndOrg('x', 'y')).toBeNull();
    });
  });

  // ── findExportsByOrg ───────────────────────────────────────────────────────

  describe('findExportsByOrg', () => {
    it('queries with correct pagination and ordering', async () => {
      const records = [makeOrgExport()];
      mockPrisma.orgExport.findMany.mockResolvedValue(records);

      const result = await repo.findExportsByOrg(ORG_UUID, 10, 20);

      expect(mockPrisma.orgExport.findMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 20,
      });
      expect(result).toEqual(records);
    });
  });

  // ── findExpiredExports ─────────────────────────────────────────────────────

  describe('findExpiredExports', () => {
    it('queries for COMPLETED exports with expiresAt <= now', async () => {
      const now = new Date('2026-01-15');
      mockPrisma.orgExport.findMany.mockResolvedValue([]);

      await repo.findExpiredExports(now);

      expect(mockPrisma.orgExport.findMany).toHaveBeenCalledWith({
        where: {
          status: ExportStatus.COMPLETED,
          expiresAt: { lte: now },
        },
      });
    });

    it('returns matched records', async () => {
      const record = makeOrgExport({ status: ExportStatus.COMPLETED });
      mockPrisma.orgExport.findMany.mockResolvedValue([record]);

      const result = await repo.findExpiredExports(new Date());
      expect(result).toHaveLength(1);
    });
  });

  // ── markExportExpired ──────────────────────────────────────────────────────

  describe('markExportExpired', () => {
    it('updates status to EXPIRED', async () => {
      await repo.markExportExpired(EXPORT_UUID);

      expect(mockPrisma.orgExport.update).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID },
        data: { status: ExportStatus.EXPIRED },
      });
    });
  });

  // ── markExportsExpiredBatch ────────────────────────────────────────────────

  describe('markExportsExpiredBatch', () => {
    it('bulk-updates all ids and returns count', async () => {
      mockPrisma.orgExport.updateMany.mockResolvedValue({ count: 3 });

      const result = await repo.markExportsExpiredBatch([
        'id-1',
        'id-2',
        'id-3',
      ]);

      expect(mockPrisma.orgExport.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['id-1', 'id-2', 'id-3'] } },
        data: { status: ExportStatus.EXPIRED },
      });
      expect(result).toBe(3);
    });
  });

  // ── createJobAndExport ─────────────────────────────────────────────────────

  describe('createJobAndExport', () => {
    it('runs a transaction creating job and orgExport and returns ids', async () => {
      const input: CreateExportJobInput = {
        orgId: ORG_UUID,
        userId: USER_UUID,
        exportEventType: 'org.export.requested',
      };

      const result = await repo.createJobAndExport(input);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result.exportId).toBeDefined();
      expect(result.jobId).toBeDefined();
      expect(typeof result.exportId).toBe('string');
      expect(typeof result.jobId).toBe('string');

      const tx = mockPrisma.__tx;
      expect(tx.job.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: ORG_UUID,
            userId: USER_UUID,
            type: 'org.export.requested',
            status: JobStatus.PENDING,
          }),
        }),
      );
      expect(tx.orgExport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: ORG_UUID,
            requestedByUserId: USER_UUID,
            status: ExportStatus.PENDING,
          }),
        }),
      );
    });
  });

  // ── markExportProcessing ───────────────────────────────────────────────────

  describe('markExportProcessing', () => {
    it('updates orgExport to PROCESSING and job to PROCESSING', async () => {
      await repo.markExportProcessing(EXPORT_UUID, JOB_UUID);

      expect(mockPrisma.orgExport.update).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID },
        data: { status: ExportStatus.PROCESSING },
      });
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: JOB_UUID },
        data: expect.objectContaining({
          status: JobStatus.PROCESSING,
          attempts: { increment: 1 },
          startedAt: expect.any(Date),
        }),
      });
    });
  });

  // ── completeExport ─────────────────────────────────────────────────────────

  describe('completeExport', () => {
    it('updates orgExport to COMPLETED and job to DONE', async () => {
      const input: CompleteExportInput = {
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
        downloadUrl: 'https://s3.example.com/export.zip',
        fileSize: 102400,
        expiresAt: new Date('2026-02-01'),
        completedAt: new Date('2026-01-15'),
      };

      await repo.completeExport(input);

      expect(mockPrisma.orgExport.update).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID },
        data: {
          status: ExportStatus.COMPLETED,
          fileUrl: input.downloadUrl,
          fileSize: BigInt(input.fileSize),
          expiresAt: input.expiresAt,
          completedAt: input.completedAt,
        },
      });
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: JOB_UUID },
        data: expect.objectContaining({
          status: JobStatus.DONE,
          result: expect.objectContaining({
            exportId: EXPORT_UUID,
            fileSize: input.fileSize,
          }),
          finishedAt: expect.any(Date),
        }),
      });
    });
  });

  // ── failExport ─────────────────────────────────────────────────────────────

  describe('failExport', () => {
    it('updates orgExport to FAILED and job to FAILED', async () => {
      const input: FailExportInput = {
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
        error: 'Storage unreachable',
      };

      await repo.failExport(input);

      expect(mockPrisma.orgExport.update).toHaveBeenCalledWith({
        where: { id: EXPORT_UUID },
        data: expect.objectContaining({
          status: ExportStatus.FAILED,
          failedAt: expect.any(Date),
          error: input.error,
        }),
      });
      expect(mockPrisma.job.update).toHaveBeenCalledWith({
        where: { id: JOB_UUID },
        data: expect.objectContaining({
          status: JobStatus.FAILED,
          error: input.error,
          finishedAt: expect.any(Date),
        }),
      });
    });
  });

  // ── findUserById ───────────────────────────────────────────────────────────

  describe('findUserById', () => {
    it('returns id and email when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: USER_UUID,
        email: 'user@example.com',
      });

      const result = await repo.findUserById(USER_UUID);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_UUID },
        select: { id: true, email: true },
      });
      expect(result).toEqual({ id: USER_UUID, email: 'user@example.com' });
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await repo.findUserById('unknown')).toBeNull();
    });
  });

  // ── aggregateOrgData ───────────────────────────────────────────────────────

  describe('aggregateOrgData', () => {
    it('aggregates data from all relevant tables in parallel', async () => {
      const org = { id: ORG_UUID, name: 'Acme', status: 'ACTIVE' };
      const membership = { id: 'm1', orgId: ORG_UUID };
      const log = { id: 'l1', orgId: ORG_UUID };
      const job = { id: 'j1', orgId: ORG_UUID };
      const file = { id: 'f1', orgId: ORG_UUID };
      const notification = { id: 'n1', orgId: ORG_UUID };

      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.membership.findMany.mockResolvedValue([membership]);
      mockPrisma.activityLog.findMany.mockResolvedValue([log]);
      mockPrisma.job.findMany.mockResolvedValue([job]);
      mockPrisma.file.findMany.mockResolvedValue([file]);
      mockPrisma.notification.findMany.mockResolvedValue([notification]);

      const result = await repo.aggregateOrgData(ORG_UUID);

      expect(result.organization).toEqual(org);
      expect(result.memberships).toEqual([membership]);
      expect(result.activityLogs).toEqual([log]);
      expect(result.jobs).toEqual([job]);
      expect(result.files).toEqual([file]);
      expect(result.notifications).toEqual([notification]);
    });

    it('includes user in membership query with correct select', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      await repo.aggregateOrgData(ORG_UUID);

      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              auth0Id: true,
              createdAt: true,
            },
          },
        },
      });
    });
  });
});
