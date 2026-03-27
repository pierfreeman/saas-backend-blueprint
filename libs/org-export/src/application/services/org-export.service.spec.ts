import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgExportService } from './org-export.service';
import { OrgExportRepository } from '../../infrastructure/repositories/org-export.repository';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { ActivityLogService } from '@libs/activity-log';
import { ExportStatus, OrganizationStatus } from '@prisma/client';
import { vi } from 'vitest';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';
const JOB_UUID = 'd4e5f6a7-b8c9-6012-de34-fa5678bc9012';

function buildRepoMock() {
  return {
    findOrgById: vi.fn(),
    createJobAndExport: vi.fn(),
    findExportByIdAndOrg: vi.fn(),
    findExportsByOrg: vi.fn(),
  };
}

function buildEventBusMock() {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
  };
}

function buildLegalAuditMock() {
  return {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function buildActivityLogMock() {
  return {
    logActivity: vi.fn(),
  };
}

function buildConfigMock() {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      return defaultValue;
    }),
  };
}

function makeOrganization(overrides = {}) {
  return {
    id: ORG_UUID,
    name: 'Test Organization',
    status: OrganizationStatus.ACTIVE,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeExport(overrides = {}) {
  return {
    id: EXPORT_UUID,
    orgId: ORG_UUID,
    jobId: JOB_UUID,
    requestedByUserId: USER_UUID,
    status: ExportStatus.PENDING,
    fileUrl: null,
    fileSize: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01'),
    completedAt: null,
    failedAt: null,
    error: null,
    ...overrides,
  };
}

describe('OrgExportService', () => {
  let service: OrgExportService;
  let repo: ReturnType<typeof buildRepoMock>;
  let eventBus: ReturnType<typeof buildEventBusMock>;
  let legalAudit: ReturnType<typeof buildLegalAuditMock>;
  let activityLog: ReturnType<typeof buildActivityLogMock>;
  let config: ReturnType<typeof buildConfigMock>;

  beforeEach(async () => {
    repo = buildRepoMock();
    eventBus = buildEventBusMock();
    legalAudit = buildLegalAuditMock();
    activityLog = buildActivityLogMock();
    config = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgExportService,
        { provide: OrgExportRepository, useValue: repo },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OrgExportService>(OrgExportService);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── requestExport ──────────────────────────────────────────────────────────

  describe('requestExport', () => {
    it('throws NotFoundException when organization does not exist', async () => {
      repo.findOrgById.mockResolvedValueOnce(null);

      await expect(service.requestExport(ORG_UUID, USER_UUID)).rejects.toThrow(
        NotFoundException,
      );

      expect(repo.createJobAndExport).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when organization is DELETED', async () => {
      const org = makeOrganization({ status: OrganizationStatus.DELETED });
      repo.findOrgById.mockResolvedValueOnce(org);

      await expect(service.requestExport(ORG_UUID, USER_UUID)).rejects.toThrow(
        BadRequestException,
      );

      expect(repo.createJobAndExport).not.toHaveBeenCalled();
    });

    it('creates OrgExport and Job records in a transaction', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      const exportId = await service.requestExport(ORG_UUID, USER_UUID);

      expect(repo.createJobAndExport).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_UUID,
          userId: USER_UUID,
          exportEventType: 'org.export.requested',
        }),
      );
      expect(exportId).toBe(EXPORT_UUID);
    });

    it('emits OrgExportRequestedEvent with correct payload', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      await service.requestExport(ORG_UUID, USER_UUID);

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const eventCall = eventBus.publish.mock.calls[0][0];

      expect(eventCall.eventType).toBe('org.export.requested');
      expect(eventCall.tenantId).toBe(ORG_UUID);
      expect(eventCall.userId).toBe(USER_UUID);
      expect(eventCall.timestamp).toBeInstanceOf(Date);
      expect(eventCall.payload.orgId).toBe(ORG_UUID);
      expect(eventCall.payload.requestedByUserId).toBe(USER_UUID);
      expect(eventCall.payload.orgName).toBe('Test Organization');
      expect(eventCall.payload.exportId).toBeDefined();
      expect(eventCall.payload.jobId).toBeDefined();
    });

    it('logs to activity log with correct data', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      await service.requestExport(ORG_UUID, USER_UUID);

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_UUID,
          actorId: USER_UUID,
          action: 'organization.export.requested',
          entityType: 'organization',
          entityId: ORG_UUID,
        }),
      );
    });

    it('records legal audit event with correct data', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      await service.requestExport(ORG_UUID, USER_UUID);

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'org.export.requested',
          orgId: ORG_UUID,
          userId: USER_UUID,
          triggerType: 'user_action',
          metadata: expect.objectContaining({
            organizationId: ORG_UUID,
            organizationName: 'Test Organization',
          }),
        }),
      );
    });

    it('returns the generated exportId', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      const exportId = await service.requestExport(ORG_UUID, USER_UUID);

      expect(exportId).toBe(EXPORT_UUID);
    });

    it('allows PENDING_DELETION organizations to be exported', async () => {
      const org = makeOrganization({
        status: OrganizationStatus.PENDING_DELETION,
      });
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      const exportId = await service.requestExport(ORG_UUID, USER_UUID);

      expect(exportId).toBeDefined();
      expect(repo.createJobAndExport).toHaveBeenCalled();
    });

    it('allows SUSPENDED organizations to be exported', async () => {
      const org = makeOrganization({
        status: OrganizationStatus.SUSPENDED,
      });
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.createJobAndExport.mockResolvedValueOnce({
        exportId: EXPORT_UUID,
        jobId: JOB_UUID,
      });

      const exportId = await service.requestExport(ORG_UUID, USER_UUID);

      expect(exportId).toBeDefined();
    });
  });

  // ─── getExport ──────────────────────────────────────────────────────────────

  describe('getExport', () => {
    it('returns export record when found', async () => {
      const exportRecord = makeExport();
      repo.findExportByIdAndOrg.mockResolvedValueOnce(exportRecord);

      const result = await service.getExport(EXPORT_UUID, ORG_UUID);

      expect(result).toEqual(exportRecord);
      expect(repo.findExportByIdAndOrg).toHaveBeenCalledWith(
        EXPORT_UUID,
        ORG_UUID,
      );
    });

    it('throws NotFoundException when export not found', async () => {
      repo.findExportByIdAndOrg.mockResolvedValueOnce(null);

      await expect(service.getExport(EXPORT_UUID, ORG_UUID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when export belongs to different org (IDOR protection)', async () => {
      repo.findExportByIdAndOrg.mockResolvedValueOnce(null);

      const wrongOrgId = 'wrong-org-uuid';
      await expect(service.getExport(EXPORT_UUID, wrongOrgId)).rejects.toThrow(
        NotFoundException,
      );

      expect(repo.findExportByIdAndOrg).toHaveBeenCalledWith(
        EXPORT_UUID,
        wrongOrgId,
      );
    });

    it('returns export with COMPLETED status and download URL', async () => {
      const completedExport = makeExport({
        status: ExportStatus.COMPLETED,
        fileUrl: 'https://storage.example.com/exports/...',
        fileSize: BigInt(123456),
        expiresAt: new Date('2026-01-02'),
        completedAt: new Date('2026-01-01T12:05:00Z'),
      });
      repo.findExportByIdAndOrg.mockResolvedValueOnce(completedExport);

      const result = await service.getExport(EXPORT_UUID, ORG_UUID);

      expect(result.status).toBe(ExportStatus.COMPLETED);
      expect(result.fileUrl).toBeDefined();
      expect(result.fileSize).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('returns export with FAILED status and error message', async () => {
      const failedExport = makeExport({
        status: ExportStatus.FAILED,
        error: 'Database connection failed',
        failedAt: new Date('2026-01-01T12:05:00Z'),
      });
      repo.findExportByIdAndOrg.mockResolvedValueOnce(failedExport);

      const result = await service.getExport(EXPORT_UUID, ORG_UUID);

      expect(result.status).toBe(ExportStatus.FAILED);
      expect(result.error).toBe('Database connection failed');
      expect(result.failedAt).toBeInstanceOf(Date);
    });
  });

  // ─── listExports ────────────────────────────────────────────────────────────

  describe('listExports', () => {
    it('returns paginated list of exports', async () => {
      const exports = [
        makeExport({ id: 'export-1' }),
        makeExport({ id: 'export-2' }),
      ];
      repo.findExportsByOrg.mockResolvedValueOnce(exports);

      const result = await service.listExports(ORG_UUID, 10, 0);

      expect(result).toEqual(exports);
    });

    it('queries exports with correct filters and ordering', async () => {
      repo.findExportsByOrg.mockResolvedValueOnce([]);

      await service.listExports(ORG_UUID, 20, 10);

      expect(repo.findExportsByOrg).toHaveBeenCalledWith(ORG_UUID, 20, 10);
    });

    it('uses default pagination values when not provided', async () => {
      repo.findExportsByOrg.mockResolvedValueOnce([]);

      await service.listExports(ORG_UUID);

      expect(repo.findExportsByOrg).toHaveBeenCalledWith(ORG_UUID, 10, 0);
    });

    it('returns empty list when org has no exports', async () => {
      repo.findExportsByOrg.mockResolvedValueOnce([]);

      const result = await service.listExports(ORG_UUID);

      expect(result).toEqual([]);
    });

    it('handles pagination correctly for large result sets', async () => {
      const exports = Array.from({ length: 5 }, (_, i) =>
        makeExport({ id: `export-${i + 11}` }),
      );
      repo.findExportsByOrg.mockResolvedValueOnce(exports);

      const result = await service.listExports(ORG_UUID, 5, 10);

      expect(result.length).toBe(5);
    });

    it('returns exports ordered by creation date descending', async () => {
      const export1 = makeExport({
        id: 'export-1',
        createdAt: new Date('2026-01-01'),
      });
      const export2 = makeExport({
        id: 'export-2',
        createdAt: new Date('2026-01-02'),
      });
      const export3 = makeExport({
        id: 'export-3',
        createdAt: new Date('2026-01-03'),
      });
      repo.findExportsByOrg.mockResolvedValueOnce([export3, export2, export1]);

      const result = await service.listExports(ORG_UUID);

      expect(result[0].id).toBe('export-3');
      expect(result[1].id).toBe('export-2');
      expect(result[2].id).toBe('export-1');
    });
  });
});
