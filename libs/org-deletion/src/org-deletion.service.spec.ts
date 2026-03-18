import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgDeletionService } from './org-deletion.service';
import { OrgDeletionRepository } from './infrastructure/repositories/org-deletion.repository';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { ActivityLogService } from '@libs/activity-log';
import { DeletionTrigger } from './constants/org-deletion-event.constants';
import { OrganizationStatus } from '@prisma/client';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const USER_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';

function buildRepoMock() {
  return {
    findOrgById: jest.fn(),
    markPendingDeletion: jest.fn().mockResolvedValue(undefined),
    findSuspendedOrgsWithExpiredSubscriptions: jest.fn().mockResolvedValue([]),
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

function buildConfigMock() {
  return {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'ORG_DELETION_RETENTION_DAYS') return defaultValue || 30;
      return defaultValue;
    }),
  };
}

function makeOrganization(overrides = {}) {
  return {
    id: ORG_UUID,
    name: 'Test Organization',
    status: OrganizationStatus.ACTIVE,
    deletionRequestedAt: null,
    deletionScheduledAt: null,
    deletionCompletedAt: null,
    retentionPeriodDays: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('OrgDeletionService', () => {
  let service: OrgDeletionService;
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
        OrgDeletionService,
        { provide: OrgDeletionRepository, useValue: repo },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OrgDeletionService>(OrgDeletionService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── requestDeletion ────────────────────────────────────────────────────────

  describe('requestDeletion', () => {
    it('throws NotFoundException when organization does not exist', async () => {
      repo.findOrgById.mockResolvedValueOnce(null);

      await expect(
        service.requestDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          USER_UUID,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(repo.markPendingDeletion).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when org already PENDING_DELETION', async () => {
      const org = makeOrganization({
        status: OrganizationStatus.PENDING_DELETION,
      });
      repo.findOrgById.mockResolvedValueOnce(org);

      await expect(
        service.requestDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          USER_UUID,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repo.markPendingDeletion).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when org already DELETED', async () => {
      const org = makeOrganization({
        status: OrganizationStatus.DELETED,
      });
      repo.findOrgById.mockResolvedValueOnce(org);

      await expect(
        service.requestDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          USER_UUID,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repo.markPendingDeletion).not.toHaveBeenCalled();
    });

    it('uses default retention period from config when org has no custom period', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.requestDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        USER_UUID,
      );

      const [, input] = repo.markPendingDeletion.mock.calls[0];
      const scheduledAt = input.deletionScheduledAt as Date;
      const requestedAt = input.deletionRequestedAt as Date;

      // Default is 30 days
      const expectedDiff = 30 * 24 * 60 * 60 * 1000;
      const actualDiff = scheduledAt.getTime() - requestedAt.getTime();

      expect(actualDiff).toBeGreaterThanOrEqual(expectedDiff - 1000);
      expect(actualDiff).toBeLessThanOrEqual(expectedDiff + 1000);
    });

    it('uses custom retention period when org has retentionPeriodDays set', async () => {
      const org = makeOrganization({ retentionPeriodDays: 60 });
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.requestDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        USER_UUID,
      );

      const [, input] = repo.markPendingDeletion.mock.calls[0];
      const scheduledAt = input.deletionScheduledAt as Date;
      const requestedAt = input.deletionRequestedAt as Date;

      // Custom is 60 days
      const expectedDiff = 60 * 24 * 60 * 60 * 1000;
      const actualDiff = scheduledAt.getTime() - requestedAt.getTime();

      expect(actualDiff).toBeGreaterThanOrEqual(expectedDiff - 1000);
      expect(actualDiff).toBeLessThanOrEqual(expectedDiff + 1000);
    });

    it('updates org status to PENDING_DELETION and sets timestamps', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.requestDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        USER_UUID,
      );

      expect(repo.markPendingDeletion).toHaveBeenCalledWith(
        ORG_UUID,
        expect.objectContaining({
          deletionRequestedAt: expect.any(Date),
          deletionScheduledAt: expect.any(Date),
        }),
      );
    });

    it('emits OrgDeletionRequestedEvent with correct payload', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.requestDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        USER_UUID,
      );

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      const eventCall = eventBus.publish.mock.calls[0][0];

      expect(eventCall.eventType).toBe('org.deletion.requested');
      expect(eventCall.tenantId).toBe(ORG_UUID);
      expect(eventCall.userId).toBe(USER_UUID);
      expect(eventCall.timestamp).toBeInstanceOf(Date);
      expect(eventCall.payload.orgId).toBe(ORG_UUID);
      expect(eventCall.payload.trigger).toBe(DeletionTrigger.USER_REQUEST);
      expect(eventCall.payload.orgName).toBe('Test Organization');
    });

    it('allows undefined userId for system-triggered deletions', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.requestDeletion(
        ORG_UUID,
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        undefined,
      );

      const eventCall = eventBus.publish.mock.calls[0][0];
      expect(eventCall.userId).toBeUndefined();
      expect(eventCall.payload.trigger).toBe(
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
      );
    });
  });
});
