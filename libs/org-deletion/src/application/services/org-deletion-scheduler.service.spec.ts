import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrgDeletionSchedulerService } from './org-deletion-scheduler.service';
import { OrgDeletionRepository } from '../../infrastructure/repositories/org-deletion.repository';
import { OrgDeletionService } from './org-deletion.service';
import { DeletionTrigger } from '../../constants/org-deletion-event.constants';
import { vi } from 'vitest';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG1_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const ORG2_UUID = 'b2c3d4e5-f6a7-4890-bc12-de3456fa7890';

function buildRepoMock() {
  return {
    findOrgsEligibleForDeletion: vi.fn().mockResolvedValue([]),
  };
}

function buildDeletionServiceMock() {
  return {
    requestDeletion: vi.fn().mockResolvedValue(undefined),
  };
}

function buildConfigMock() {
  return {
    get: vi.fn((key: string) => {
      if (key === 'ORG_DELETION_CHECK_CRON') return '0 3 * * *';
      return undefined;
    }),
  };
}

function makeOrganization(id: string, scheduledAt: Date) {
  return {
    id,
    name: `Test Organization ${id}`,
    status: 'SUSPENDED',
    deletionRequestedAt: new Date('2026-01-01'),
    deletionScheduledAt: scheduledAt,
    deletionCompletedAt: null,
    retentionPeriodDays: 30,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

describe('OrgDeletionSchedulerService', () => {
  let service: OrgDeletionSchedulerService;
  let repo: ReturnType<typeof buildRepoMock>;
  let deletionService: ReturnType<typeof buildDeletionServiceMock>;
  let config: ReturnType<typeof buildConfigMock>;

  beforeEach(async () => {
    repo = buildRepoMock();
    deletionService = buildDeletionServiceMock();
    config = buildConfigMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgDeletionSchedulerService,
        { provide: OrgDeletionRepository, useValue: repo },
        { provide: OrgDeletionService, useValue: deletionService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<OrgDeletionSchedulerService>(
      OrgDeletionSchedulerService,
    );
  });

  afterEach(() => vi.clearAllMocks());

  // ─── checkExpiredOrganizations ──────────────────────────────────────────────

  describe('checkExpiredOrganizations', () => {
    it('finds SUSPENDED orgs with deletionScheduledAt in the past', async () => {
      const now = new Date('2026-02-15');
      vi.useFakeTimers().setSystemTime(now);

      await service.checkExpiredOrganizations();

      expect(repo.findOrgsEligibleForDeletion).toHaveBeenCalledWith(now);

      vi.useRealTimers();
    });

    it('triggers deletion for each expired organization', async () => {
      const org1 = makeOrganization(ORG1_UUID, new Date('2026-02-01'));
      const org2 = makeOrganization(ORG2_UUID, new Date('2026-02-10'));

      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([org1, org2]);

      await service.checkExpiredOrganizations();

      expect(deletionService.requestDeletion).toHaveBeenCalledTimes(2);
      expect(deletionService.requestDeletion).toHaveBeenCalledWith(
        ORG1_UUID,
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        undefined,
      );
      expect(deletionService.requestDeletion).toHaveBeenCalledWith(
        ORG2_UUID,
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        undefined,
      );
    });

    it('passes undefined userId for automated deletions', async () => {
      const org = makeOrganization(ORG1_UUID, new Date('2026-02-01'));
      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([org]);

      await service.checkExpiredOrganizations();

      const requestDeletionCall = deletionService.requestDeletion.mock.calls[0];
      expect(requestDeletionCall[2]).toBeUndefined();
    });

    it('continues processing remaining orgs if one deletion fails', async () => {
      const org1 = makeOrganization(ORG1_UUID, new Date('2026-02-01'));
      const org2 = makeOrganization(ORG2_UUID, new Date('2026-02-10'));

      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([org1, org2]);
      deletionService.requestDeletion
        .mockRejectedValueOnce(new Error('Deletion failed'))
        .mockResolvedValueOnce(undefined);

      await service.checkExpiredOrganizations();

      expect(deletionService.requestDeletion).toHaveBeenCalledTimes(2);
    });

    it('does not throw when findOrgsEligibleForDeletion fails', async () => {
      repo.findOrgsEligibleForDeletion.mockRejectedValueOnce(
        new Error('DB error'),
      );

      await expect(service.checkExpiredOrganizations()).resolves.not.toThrow();
    });

    it('stringifies non-Error thrown by requestDeletion (inner catch — String branch)', async () => {
      const org = makeOrganization(ORG1_UUID, new Date('2026-02-01'));
      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([org]);
      // Reject with a non-Error value: covers `String(error)` branch on line 70
      deletionService.requestDeletion.mockRejectedValueOnce(
        'plain string error',
      );

      await expect(service.checkExpiredOrganizations()).resolves.not.toThrow();
    });

    it('stringifies non-Error thrown by findOrgsEligibleForDeletion (outer catch — String branch)', async () => {
      // Reject with a non-Error value: covers `String(error)` branch on line 80
      repo.findOrgsEligibleForDeletion.mockRejectedValueOnce(
        'plain string error',
      );

      await expect(service.checkExpiredOrganizations()).resolves.not.toThrow();
    });

    it('logs when no organizations are eligible for deletion', async () => {
      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([]);
      const logSpy = vi
        .spyOn(service['logger'], 'log')
        .mockImplementation(() => undefined);

      await service.checkExpiredOrganizations();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 0 organizations eligible for deletion'),
      );
    });

    it('logs when organizations are found and deleted', async () => {
      const org1 = makeOrganization(ORG1_UUID, new Date('2026-02-01'));
      const org2 = makeOrganization(ORG2_UUID, new Date('2026-02-10'));

      repo.findOrgsEligibleForDeletion.mockResolvedValueOnce([org1, org2]);
      const logSpy = vi
        .spyOn(service['logger'], 'log')
        .mockImplementation(() => undefined);

      await service.checkExpiredOrganizations();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 2 organizations eligible for deletion'),
      );
    });
  });
});
