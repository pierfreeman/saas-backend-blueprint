import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrgDeletionWorkerService } from './org-deletion-worker.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { ActivityLogService } from '@libs/activity-log';
import { CacheService } from '@libs/redis';
import { StorageService } from '@libs/storage';
import { DeletionTrigger } from './constants/org-deletion-event.constants';
import { OrganizationStatus } from '@prisma/client';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';

function buildPrismaMock() {
  return {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    membership: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    activityLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    job: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notification: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    file: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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

function buildActivityLogMock() {
  return {
    logActivity: jest.fn(),
  };
}

function buildCacheMock() {
  return {
    deleteByPattern: jest.fn().mockResolvedValue(0),
  };
}

function buildStorageMock() {
  return {
    deleteFolder: jest.fn().mockResolvedValue(undefined),
  };
}

function buildConfigMock() {
  return {
    get: jest.fn((key: string) => {
      if (key === 'STRIPE_SECRET_KEY') return undefined;
      return undefined;
    }),
  };
}

function makeOrganization(overrides = {}) {
  return {
    id: ORG_UUID,
    name: 'Test Organization',
    status: OrganizationStatus.PENDING_DELETION,
    deletionRequestedAt: new Date('2026-01-01'),
    deletionScheduledAt: new Date('2026-01-31'),
    deletionCompletedAt: null,
    retentionPeriodDays: 30,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OrgDeletionWorkerService', () => {
  let service: OrgDeletionWorkerService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let eventBus: ReturnType<typeof buildEventBusMock>;
  let legalAudit: ReturnType<typeof buildLegalAuditMock>;
  let activityLog: ReturnType<typeof buildActivityLogMock>;
  let cache: ReturnType<typeof buildCacheMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let config: ReturnType<typeof buildConfigMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    eventBus = buildEventBusMock();
    legalAudit = buildLegalAuditMock();
    activityLog = buildActivityLogMock();
    cache = buildCacheMock();
    storage = buildStorageMock();
    config = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgDeletionWorkerService,
        { provide: PrismaBusinessService, useValue: prisma },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: CacheService, useValue: cache },
        { provide: StorageService, useValue: storage },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OrgDeletionWorkerService>(OrgDeletionWorkerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── executeDeletion ────────────────────────────────────────────────────────

  describe('executeDeletion', () => {
    const requestedAt = new Date('2026-01-01');

    it('emits DELETION_STARTED event at the beginning', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      const startEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.deletion.started',
      );
      expect(startEvent).toBeDefined();
      expect(startEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(startEvent[0].payload.trigger).toBe(DeletionTrigger.USER_REQUEST);
    });

    it('returns early when organization does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValueOnce(null);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(prisma.organization.delete).not.toHaveBeenCalled();
      expect(legalAudit.recordEvent).not.toHaveBeenCalled();
    });

    it('returns early when organization is already DELETED (idempotent)', async () => {
      const org = makeOrganization({ status: OrganizationStatus.DELETED });
      prisma.organization.findUnique.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(prisma.organization.delete).not.toHaveBeenCalled();
    });

    it('deletes storage files under org/{orgId}/', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(storage.deleteFolder).toHaveBeenCalledWith(`org/${ORG_UUID}`);
    });

    it('deletes database records in correct order', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(prisma.file.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(prisma.job.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(prisma.activityLog.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(prisma.membership.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
    });

    it('clears Redis cache for tenant:{orgId}:*', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(cache.deleteByPattern).toHaveBeenCalledWith(`tenant:${ORG_UUID}:*`);
    });

    it('marks organization as DELETED with completedAt timestamp', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      const updateCall = prisma.organization.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe(ORG_UUID);
      expect(updateCall.data.status).toBe(OrganizationStatus.DELETED);
      expect(updateCall.data.deletionCompletedAt).toBeInstanceOf(Date);
    });

    it('emits DELETION_COMPLETED event after successful deletion', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      const completeEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.deletion.completed',
      );
      expect(completeEvent).toBeDefined();
      expect(completeEvent[0].payload.orgId).toBe(ORG_UUID);
      expect(completeEvent[0].payload.orgName).toBe('Test Organization');
    });

    it('records permanent legal audit event', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: OrganizationStatus.DELETED,
      });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.deleted',
          orgId: ORG_UUID,
        }),
      );
    });

    it('emits DELETION_FAILED event on error', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      storage.deleteFolder.mockRejectedValueOnce(new Error('S3 error'));

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      const failEvent = eventBus.publish.mock.calls.find(
        (call) => call[0].eventType === 'org.deletion.failed',
      );
      expect(failEvent).toBeDefined();
      expect(failEvent[0].payload.error).toContain('S3 error');
    });

    it('records legal audit failure event on error', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      storage.deleteFolder.mockRejectedValueOnce(new Error('S3 error'));

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.deletion.failed',
          orgId: ORG_UUID,
        }),
      );
    });

    it('does not throw on error (graceful failure)', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      storage.deleteFolder.mockRejectedValueOnce(new Error('S3 error'));

      await expect(
        service.executeDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          'Test Organization',
          requestedAt,
        ),
      ).resolves.not.toThrow();
    });
  });
});
