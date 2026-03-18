import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrgExportWorkerService } from './org-export-worker.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { StorageService } from '@libs/storage';
import { ExportStatus, JobStatus } from '@prisma/client';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';
const JOB_UUID = 'd4e5f6a7-b8c9-6012-de34-fa5678bc9012';

function buildPrismaMock() {
  return {
    organization: {
      findUnique: jest.fn(),
    },
    orgExport: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    job: {
      update: jest.fn(),
      findMany: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
    },
    activityLog: {
      findMany: jest.fn(),
    },
    file: {
      findMany: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
    },
  };
}

function buildEventBusMock() {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
  };
}

function buildLegalAuditMock() {
  return {
    recordEvent: jest.fn().mockResolvedValue(undefined),
  };
}

function buildStorageMock() {
  return {
    generateDownloadUrl: jest.fn().mockResolvedValue({
      downloadUrl: 'https://storage.example.com/exports/...',
      expiresAt: new Date('2026-01-02'),
      filename: 'export.json.gz',
      mimeType: 'application/gzip',
      size: BigInt(123456),
    }),
  };
}

function buildConfigMock() {
  return {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'EXPORT_URL_EXPIRATION_HOURS') return defaultValue || 24;
      return defaultValue;
    }),
  };
}

function makeOrganization(overrides = {}) {
  return {
    id: ORG_UUID,
    name: 'Test Organization',
    status: 'ACTIVE',
    billingStatus: 'ACTIVE',
    planId: 'plan_123',
    seatCount: 5,
    maxSeats: 10,
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

describe('OrgExportWorkerService', () => {
  let service: OrgExportWorkerService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let eventBus: ReturnType<typeof buildEventBusMock>;
  let legalAudit: ReturnType<typeof buildLegalAuditMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let config: ReturnType<typeof buildConfigMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    eventBus = buildEventBusMock();
    legalAudit = buildLegalAuditMock();
    storage = buildStorageMock();
    config = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgExportWorkerService,
        { provide: PrismaBusinessService, useValue: prisma },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: StorageService, useValue: storage },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OrgExportWorkerService>(OrgExportWorkerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── executeExport ──────────────────────────────────────────────────────────

  describe('executeExport', () => {
    const requestedAt = new Date('2026-01-01T10:00:00Z');
    const orgName = 'Test Organization';

    beforeEach(() => {
      // Setup default mocks for successful export
      prisma.orgExport.findUnique.mockResolvedValue(makeExport());
      prisma.organization.findUnique.mockResolvedValue(makeOrganization());
      prisma.membership.findMany.mockResolvedValue([]);
      prisma.activityLog.findMany.mockResolvedValue([]);
      prisma.job.findMany.mockResolvedValue([]);
      prisma.file.findMany.mockResolvedValue([]);
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.orgExport.update.mockResolvedValue(
        makeExport({ status: ExportStatus.COMPLETED }),
      );
      prisma.job.update.mockResolvedValue({});
    });

    it('emits EXPORT_STARTED event at the beginning', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const startEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.export.started',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(startEvent[0].payload.exportId).toBe(EXPORT_UUID);
      expect(startEvent[0].payload.startedAt).toBeInstanceOf(Date);
    });

    it('returns early when export does not exist (idempotent)', async () => {
      prisma.orgExport.findUnique.mockResolvedValueOnce(null);

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.orgExport.update).not.toHaveBeenCalled();
      expect(prisma.job.update).not.toHaveBeenCalled();
    });

    it('returns early when export is already COMPLETED (idempotent)', async () => {
      prisma.orgExport.findUnique.mockResolvedValueOnce(
        makeExport({ status: ExportStatus.COMPLETED }),
      );

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      // Should only check status, not update
      const updateCalls = prisma.orgExport.update.mock.calls;
      expect(updateCalls.length).toBe(0);
    });

    it('updates export status to PROCESSING before starting work', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const processingUpdateCall = prisma.orgExport.update.mock.calls.find(
        (call) => call[0].data?.status === ExportStatus.PROCESSING,
      );
      expect(processingUpdateCall).toBeDefined();
      expect(processingUpdateCall[0].where.id).toBe(EXPORT_UUID);
    });

    it('updates job status to PROCESSING and increments attempts', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const processingJobCall = prisma.job.update.mock.calls.find(
        (call) => call[0].data?.status === JobStatus.PROCESSING,
      );
      expect(processingJobCall).toBeDefined();
      expect(processingJobCall[0].where.id).toBe(JOB_UUID);
      expect(processingJobCall[0].data.attempts).toEqual({ increment: 1 });
      expect(processingJobCall[0].data.startedAt).toBeInstanceOf(Date);
    });

    it('aggregates organization data from all relevant tables', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_UUID },
      });
      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG_UUID },
        }),
      );
      expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG_UUID },
        }),
      );
      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG_UUID },
        }),
      );
      expect(prisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG_UUID },
        }),
      );
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId: ORG_UUID },
        }),
      );
    });

    it('limits activity logs to most recent 1000 entries', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.activityLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1000,
        }),
      );
    });

    it('limits jobs to most recent 100 entries', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });

    it('limits notifications to most recent 500 entries', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 500,
        }),
      );
    });

    it('marks export as COMPLETED with file metadata', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const completedUpdateCall = prisma.orgExport.update.mock.calls.find(
        (call) => call[0].data?.status === ExportStatus.COMPLETED,
      );
      expect(completedUpdateCall).toBeDefined();
      expect(completedUpdateCall[0].where.id).toBe(EXPORT_UUID);
      expect(completedUpdateCall[0].data.fileUrl).toBeDefined();
      expect(completedUpdateCall[0].data.fileSize).toBeDefined();
      expect(completedUpdateCall[0].data.expiresAt).toBeInstanceOf(Date);
      expect(completedUpdateCall[0].data.completedAt).toBeInstanceOf(Date);
    });

    it('marks job as DONE with result metadata', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const doneJobCall = prisma.job.update.mock.calls.find(
        (call) => call[0].data?.status === JobStatus.DONE,
      );
      expect(doneJobCall).toBeDefined();
      expect(doneJobCall[0].where.id).toBe(JOB_UUID);
      expect(doneJobCall[0].data.result).toEqual(
        expect.objectContaining({
          exportId: EXPORT_UUID,
          fileSize: expect.any(Number),
        }),
      );
      expect(doneJobCall[0].data.finishedAt).toBeInstanceOf(Date);
    });

    it('emits EXPORT_COMPLETED event after successful export', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const completeEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.export.completed',
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(completeEvent[0].payload.exportId).toBe(EXPORT_UUID);
      expect(completeEvent[0].payload.orgName).toBe(orgName);
      expect(completeEvent[0].payload.requestedByUserId).toBe(USER_UUID);
      expect(completeEvent[0].payload.fileSize).toBeDefined();
      expect(completeEvent[0].payload.fileUrl).toBeDefined();
    });

    it('records permanent legal audit event on completion', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.export.completed',
          orgId: ORG_UUID,
          triggerType: 'user',
          metadata: expect.objectContaining({
            organizationId: ORG_UUID,
            organizationName: orgName,
            exportId: EXPORT_UUID,
            requestedByUserId: USER_UUID,
          }),
        }),
      );
    });

    it('uses configured expiration hours for download URL', async () => {
      // Re-create service with custom config that returns 48 hours
      const customConfig = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'EXPORT_URL_EXPIRATION_HOURS') return 48;
          return defaultValue;
        }),
      };

      const customService = new OrgExportWorkerService(
        prisma as any,
        eventBus as any,
        legalAudit as any,
        storage as any,
        customConfig as any,
      );

      await customService.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const completedUpdate = prisma.orgExport.update.mock.calls.find(
        (call) => call[0].data?.status === ExportStatus.COMPLETED,
      );
      const expiresAt = completedUpdate[0].data.expiresAt as Date;
      const now = new Date();
      const hoursDiff =
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Should be approximately 48 hours (with small tolerance for test execution time)
      expect(hoursDiff).toBeGreaterThan(47);
      expect(hoursDiff).toBeLessThan(49);
    });

    it('marks export as FAILED and updates error message on failure', async () => {
      const errorMessage = 'Database connection failed';
      prisma.organization.findUnique.mockRejectedValueOnce(
        new Error(errorMessage),
      );

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const failedUpdateCall = prisma.orgExport.update.mock.calls.find(
        (call) => call[0].data?.status === ExportStatus.FAILED,
      );
      expect(failedUpdateCall).toBeDefined();
      expect(failedUpdateCall[0].where.id).toBe(EXPORT_UUID);
      expect(failedUpdateCall[0].data.error).toContain(errorMessage);
      expect(failedUpdateCall[0].data.failedAt).toBeInstanceOf(Date);
    });

    it('marks job as FAILED with error message on failure', async () => {
      const errorMessage = 'Aggregation error';
      prisma.membership.findMany.mockRejectedValueOnce(
        new Error(errorMessage),
      );

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const failedJobCall = prisma.job.update.mock.calls.find(
        (call) => call[0].data?.status === JobStatus.FAILED,
      );
      expect(failedJobCall).toBeDefined();
      expect(failedJobCall[0].where.id).toBe(JOB_UUID);
      expect(failedJobCall[0].data.error).toContain(errorMessage);
      expect(failedJobCall[0].data.finishedAt).toBeInstanceOf(Date);
    });

    it('emits EXPORT_FAILED event on error', async () => {
      prisma.organization.findUnique.mockRejectedValueOnce(
        new Error('Test error'),
      );

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const failEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.export.failed',
      );
      expect(failEvent).toBeDefined();
      expect(failEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(failEvent[0].payload.exportId).toBe(EXPORT_UUID);
      expect(failEvent[0].payload.error).toContain('Test error');
    });

    it('records legal audit failure event on error', async () => {
      prisma.file.findMany.mockRejectedValueOnce(new Error('Storage error'));

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.export.failed',
          orgId: ORG_UUID,
        }),
      );
    });

    it('re-throws error for SQS DLQ handling', async () => {
      prisma.organization.findUnique.mockRejectedValueOnce(
        new Error('Critical error'),
      );

      await expect(
        service.executeExport(
          ORG_UUID,
          EXPORT_UUID,
          JOB_UUID,
          orgName,
          USER_UUID,
          requestedAt,
        ),
      ).rejects.toThrow('Critical error');
    });

    it('handles organization not found gracefully', async () => {
      prisma.organization.findUnique.mockResolvedValueOnce(null);

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      // Should complete with null organization
      const completedUpdate = prisma.orgExport.update.mock.calls.find(
        (call) => call[0].data?.status === ExportStatus.COMPLETED,
      );
      expect(completedUpdate).toBeDefined();
    });

    it('includes user information in membership export', async () => {
      prisma.membership.findMany.mockResolvedValueOnce([
        {
          id: 'membership-1',
          userId: USER_UUID,
          orgId: ORG_UUID,
          role: 'OWNER',
          status: 'ACTIVE',
          user: {
            id: USER_UUID,
            email: 'owner@example.com',
            auth0Id: 'auth0|123',
            createdAt: new Date('2026-01-01'),
          },
        },
      ]);

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            user: expect.objectContaining({
              select: expect.objectContaining({
                email: true,
                auth0Id: true,
              }),
            }),
          }),
        }),
      );
    });

    it('exports include metadata with version and timestamp', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      // Export should complete successfully
      expect(prisma.orgExport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ExportStatus.COMPLETED,
          }),
        }),
      );
    });

    it('handles BigInt serialization in file sizes', async () => {
      prisma.file.findMany.mockResolvedValueOnce([
        {
          id: 'file-1',
          filename: 'test.pdf',
          size: BigInt('9999999999'),
          mimeType: 'application/pdf',
          storageKey: 'org/test/file-1',
        },
      ]);

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(prisma.orgExport.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ExportStatus.COMPLETED,
          }),
        }),
      );
    });
  });
});
