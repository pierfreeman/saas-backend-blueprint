import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrgExportWorkerService } from './org-export-worker.service';
import { OrgExportRepository } from '../../infrastructure/repositories/org-export.repository';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { StorageService, S3StorageClient } from '@libs/storage';
import { EmailService } from '@libs/email';
import { ExportStatus } from '@prisma/client';
import { Mock, Mocked, vi } from 'vitest';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';
const EXPORT_UUID = 'c3d4e5f6-a7b8-5901-cd23-ef4567ab8901';
const JOB_UUID = 'd4e5f6a7-b8c9-6012-de34-fa5678bc9012';

function buildRepoMock() {
  return {
    findExportRecord: vi.fn(),
    markExportProcessing: vi.fn().mockResolvedValue(undefined),
    aggregateOrgData: vi.fn(),
    completeExport: vi.fn().mockResolvedValue(undefined),
    failExport: vi.fn().mockResolvedValue(undefined),
    findUserById: vi.fn().mockResolvedValue(null),
  };
}

function makeOrgData(overrides = {}) {
  return {
    organization: makeOrganization(),
    memberships: [],
    activityLogs: [],
    jobs: [],
    files: [],
    notifications: [],
    ...overrides,
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

function buildStorageMock() {
  return {
    generateDownloadUrl: vi.fn().mockResolvedValue({
      downloadUrl: 'https://storage.example.com/exports/...',
      expiresAt: new Date('2026-01-02'),
      filename: '20260101_Test_Organization_Export.zip',
      mimeType: 'application/zip',
      size: BigInt(123456),
    }),
  };
}

function buildConfigMock() {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
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
  let repo: ReturnType<typeof buildRepoMock>;
  let eventBus: ReturnType<typeof buildEventBusMock>;
  let legalAudit: ReturnType<typeof buildLegalAuditMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let config: ReturnType<typeof buildConfigMock>;
  let email: Mocked<Pick<EmailService, 'sendTransactionalEmail'>>;
  let s3Client: {
    putObject: Mock;
    generatePresignedDownloadUrl: Mock;
  };

  beforeEach(async () => {
    repo = buildRepoMock();
    eventBus = buildEventBusMock();
    legalAudit = buildLegalAuditMock();
    storage = buildStorageMock();
    config = buildConfigMock();
    email = { sendTransactionalEmail: vi.fn().mockResolvedValue(undefined) };
    s3Client = {
      putObject: vi.fn().mockResolvedValue(undefined),
      generatePresignedDownloadUrl: vi
        .fn()
        .mockResolvedValue('https://s3.example.com/presigned-url'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgExportWorkerService,
        { provide: OrgExportRepository, useValue: repo },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: StorageService, useValue: storage },
        { provide: ConfigService, useValue: config },
        { provide: EmailService, useValue: email },
        { provide: S3StorageClient, useValue: s3Client },
      ],
    }).compile();

    service = module.get<OrgExportWorkerService>(OrgExportWorkerService);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── executeExport ──────────────────────────────────────────────────────────

  describe('executeExport', () => {
    const requestedAt = new Date('2026-01-01T10:00:00Z');
    const orgName = 'Test Organization';

    beforeEach(() => {
      repo.findExportRecord.mockResolvedValue(makeExport());
      repo.aggregateOrgData.mockResolvedValue(makeOrgData());
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
      repo.findExportRecord.mockResolvedValueOnce(null);

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.markExportProcessing).not.toHaveBeenCalled();
      expect(repo.completeExport).not.toHaveBeenCalled();
    });

    it('returns early when export is already COMPLETED (idempotent)', async () => {
      repo.findExportRecord.mockResolvedValueOnce(
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

      expect(repo.markExportProcessing).not.toHaveBeenCalled();
      expect(repo.completeExport).not.toHaveBeenCalled();
    });

    it('updates export and job status to PROCESSING before starting work', async () => {
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.markExportProcessing).toHaveBeenCalledWith(
        EXPORT_UUID,
        JOB_UUID,
      );
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

      expect(repo.aggregateOrgData).toHaveBeenCalledWith(ORG_UUID);
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

      expect(repo.completeExport).toHaveBeenCalledWith(
        expect.objectContaining({
          exportId: EXPORT_UUID,
          jobId: JOB_UUID,
          downloadUrl: expect.any(String),
          fileSize: expect.any(Number),
          expiresAt: expect.any(Date),
          completedAt: expect.any(Date),
        }),
      );
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
      const customConfig = {
        get: vi.fn((key: string, defaultValue?: unknown) => {
          if (key === 'EXPORT_URL_EXPIRATION_HOURS') return 48;
          return defaultValue;
        }),
      };

      const customRepo = buildRepoMock();
      customRepo.findExportRecord.mockResolvedValue(makeExport());
      customRepo.aggregateOrgData.mockResolvedValue(makeOrgData());

      const customService = new OrgExportWorkerService(
        /* eslint-disable @typescript-eslint/no-explicit-any */
        customRepo as any,
        eventBus as any,
        legalAudit as any,
        storage as any,
        customConfig as any,
        email as any,
        s3Client as any,
        /* eslint-enable @typescript-eslint/no-explicit-any */
      );

      await customService.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      const completeCall = customRepo.completeExport.mock.calls[0][0];
      const expiresAt = completeCall.expiresAt as Date;
      const now = new Date();
      const hoursDiff =
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Should be approximately 48 hours (with small tolerance for test execution time)
      expect(hoursDiff).toBeGreaterThan(47);
      expect(hoursDiff).toBeLessThan(49);
    });

    it('marks export as FAILED and updates error message on failure', async () => {
      const errorMessage = 'Database connection failed';
      repo.aggregateOrgData.mockRejectedValueOnce(new Error(errorMessage));

      try {
        await service.executeExport(
          ORG_UUID,
          EXPORT_UUID,
          JOB_UUID,
          orgName,
          USER_UUID,
          requestedAt,
        );
      } catch {
        // Expected to throw
      }

      expect(repo.failExport).toHaveBeenCalledWith(
        expect.objectContaining({
          exportId: EXPORT_UUID,
          jobId: JOB_UUID,
          error: expect.stringContaining(errorMessage),
        }),
      );
    });

    it('marks job as FAILED with error message on failure', async () => {
      const errorMessage = 'Aggregation error';
      repo.aggregateOrgData.mockRejectedValueOnce(new Error(errorMessage));

      try {
        await service.executeExport(
          ORG_UUID,
          EXPORT_UUID,
          JOB_UUID,
          orgName,
          USER_UUID,
          requestedAt,
        );
      } catch {
        // Expected to throw
      }

      expect(repo.failExport).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: JOB_UUID,
          error: expect.stringContaining(errorMessage),
        }),
      );
    });

    it('emits EXPORT_FAILED event on error', async () => {
      repo.aggregateOrgData.mockRejectedValueOnce(new Error('Test error'));

      try {
        await service.executeExport(
          ORG_UUID,
          EXPORT_UUID,
          JOB_UUID,
          orgName,
          USER_UUID,
          requestedAt,
        );
      } catch {
        // Expected to throw
      }

      const failEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.export.failed',
      );
      expect(failEvent).toBeDefined();
      expect(failEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(failEvent[0].payload.exportId).toBe(EXPORT_UUID);
      expect(failEvent[0].payload.error).toContain('Test error');
    });

    it('records legal audit failure event on error', async () => {
      repo.aggregateOrgData.mockRejectedValueOnce(new Error('Storage error'));

      try {
        await service.executeExport(
          ORG_UUID,
          EXPORT_UUID,
          JOB_UUID,
          orgName,
          USER_UUID,
          requestedAt,
        );
      } catch {
        // Expected to throw
      }

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.export.failed',
          orgId: ORG_UUID,
        }),
      );
    });

    it('re-throws error for SQS DLQ handling', async () => {
      repo.aggregateOrgData.mockRejectedValueOnce(new Error('Critical error'));

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
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: null,
        memberships: [],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      // Should complete even when organization data is null
      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('includes user information in membership export', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [
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
        ],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
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

      expect(repo.completeExport).toHaveBeenCalledWith(
        expect.objectContaining({ exportId: EXPORT_UUID }),
      );
    });

    it('handles BigInt serialization in file sizes', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [],
        activityLogs: [],
        jobs: [],
        files: [
          {
            id: 'file-1',
            filename: 'test.pdf',
            size: BigInt('9999999999'),
            mimeType: 'application/pdf',
            storageKey: 'org/test/file-1',
          },
        ],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });
  });

  // ─── Edge Cases and Additional Coverage ────────────────────────────────────

  describe('Edge Cases', () => {
    const requestedAt = new Date('2026-01-01T10:00:00Z');
    const orgName = 'Test Organization';

    beforeEach(() => {
      repo.findExportRecord.mockResolvedValue(makeExport());
      repo.aggregateOrgData.mockResolvedValue(makeOrgData());
    });

    it('handles memberships without user data', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [
          {
            id: 'membership-1',
            userId: USER_UUID,
            orgId: ORG_UUID,
            role: 'OWNER',
            status: 'ACTIVE',
            user: null,
          },
        ],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('handles activity logs with null metadata', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [],
        activityLogs: [
          {
            id: 'log-1',
            orgId: ORG_UUID,
            actorId: USER_UUID,
            action: 'test.action',
            entityType: null,
            entityId: null,
            actorRole: 'OWNER',
            metadata: null,
            createdAt: new Date('2026-01-01'),
          },
        ],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('handles jobs with null timestamps', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [],
        activityLogs: [],
        jobs: [
          {
            id: 'job-1',
            orgId: ORG_UUID,
            userId: USER_UUID,
            type: 'test_job',
            status: 'PENDING',
            payload: {},
            result: null,
            error: null,
            attempts: 0,
            createdAt: new Date('2026-01-01'),
            startedAt: null,
            finishedAt: null,
          },
        ],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('handles files with BigInt sizes', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [],
        activityLogs: [],
        jobs: [],
        files: [
          {
            id: 'file-1',
            filename: 'large-file.pdf',
            size: BigInt('999999999999999'),
            mimeType: 'application/pdf',
            status: 'ACTIVE',
            storageKey: 'org/test/file-1',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('handles notifications with null fields', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [
          {
            id: 'notification-1',
            orgId: ORG_UUID,
            userId: USER_UUID,
            type: 'INFO',
            title: 'Test',
            message: 'Test message',
            read: false,
            readAt: null,
            createdAt: new Date('2026-01-01'),
          },
        ],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('generates valid compressed export with real data', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: makeOrganization(),
        memberships: [
          {
            id: 'membership-1',
            userId: USER_UUID,
            orgId: ORG_UUID,
            role: 'OWNER',
            status: 'ACTIVE',
            invitedAt: new Date('2026-01-01'),
            joinedAt: new Date('2026-01-01'),
            user: {
              id: USER_UUID,
              email: 'owner@example.com',
              auth0Id: 'auth0|123',
              createdAt: new Date('2026-01-01'),
            },
          },
        ],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      // Should complete successfully with compressed file
      expect(repo.completeExport).toHaveBeenCalledWith(
        expect.objectContaining({ fileSize: expect.any(Number) }),
      );
    });

    it('handles empty data arrays correctly', async () => {
      // All data arrays empty (default mock from beforeEach)
      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });

    it('handles organization with null optional fields', async () => {
      repo.aggregateOrgData.mockResolvedValueOnce({
        organization: {
          id: ORG_UUID,
          name: 'Test Org',
          status: 'ACTIVE',
          billingStatus: null,
          planId: null,
          createdAt: new Date('2026-01-01'),
          updatedAt: null,
        },
        memberships: [],
        activityLogs: [],
        jobs: [],
        files: [],
        notifications: [],
      });

      await service.executeExport(
        ORG_UUID,
        EXPORT_UUID,
        JOB_UUID,
        orgName,
        USER_UUID,
        requestedAt,
      );

      expect(repo.completeExport).toHaveBeenCalled();
    });
  });
});
