import { Test, TestingModule } from '@nestjs/testing';
import { OrgDeletionWorkerService } from './org-deletion-worker.service';
import { OrgDeletionRepository } from '../../infrastructure/repositories/org-deletion.repository';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { CacheService } from '@libs/redis';
import { StorageService } from '@libs/storage';
import { StripeService } from '@libs/billing';
import { EmailService } from '@libs/email';
import { DeletionTrigger } from '../../constants/org-deletion-event.constants';
import { OrganizationStatus } from '@libs/prisma-business';
import { Mock, vi } from 'vitest';

// ─── Valid UUIDs for testing ────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

function buildRepoMock() {
  return {
    findOrgById: vi.fn(),
    findUserByAuth0Id: vi.fn().mockResolvedValue(null),
    deleteDatabaseRecords: vi.fn().mockResolvedValue(undefined),
    markDeleted: vi.fn().mockResolvedValue(undefined),
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

function buildStripeServiceMock() {
  return {
    terminateSubscription: vi.fn().mockResolvedValue(undefined),
    deleteCustomer: vi.fn().mockResolvedValue(undefined),
  };
}

function buildCacheMock() {
  return {
    deleteByPattern: vi.fn().mockResolvedValue(0),
  };
}

function buildStorageMock() {
  return {
    deleteFolder: vi.fn().mockResolvedValue(undefined),
  };
}

function makeOrganization(overrides = {}) {
  return {
    id: ORG_UUID,
    name: 'Test Organization',
    status: OrganizationStatus.PENDING_DELETION,
    stripeCustomerId: null,
    subscriptionId: null,
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
  let repo: ReturnType<typeof buildRepoMock>;
  let eventBus: ReturnType<typeof buildEventBusMock>;
  let legalAudit: ReturnType<typeof buildLegalAuditMock>;
  let cache: ReturnType<typeof buildCacheMock>;
  let storage: ReturnType<typeof buildStorageMock>;
  let stripeService: ReturnType<typeof buildStripeServiceMock>;
  let email: { sendTransactionalEmail: Mock };

  beforeEach(async () => {
    repo = buildRepoMock();
    eventBus = buildEventBusMock();
    legalAudit = buildLegalAuditMock();
    cache = buildCacheMock();
    storage = buildStorageMock();
    stripeService = buildStripeServiceMock();
    email = { sendTransactionalEmail: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgDeletionWorkerService,
        { provide: OrgDeletionRepository, useValue: repo },
        { provide: EventBusService, useValue: eventBus },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: CacheService, useValue: cache },
        { provide: StorageService, useValue: storage },
        { provide: StripeService, useValue: stripeService },
        { provide: EmailService, useValue: email },
      ],
    }).compile();

    service = module.get<OrgDeletionWorkerService>(OrgDeletionWorkerService);
  });

  afterEach(() => vi.clearAllMocks());

  // ─── executeDeletion ────────────────────────────────────────────────────────

  describe('executeDeletion', () => {
    const requestedAt = new Date('2026-01-01');

    it('emits DELETION_STARTED event at the beginning', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

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
      repo.findOrgById.mockResolvedValueOnce(null);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(repo.deleteDatabaseRecords).not.toHaveBeenCalled();
      expect(legalAudit.recordEvent).not.toHaveBeenCalled();
    });

    it('returns early when organization is already DELETED (idempotent)', async () => {
      const org = makeOrganization({ status: OrganizationStatus.DELETED });
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(repo.deleteDatabaseRecords).not.toHaveBeenCalled();
    });

    it('deletes storage files under org/{orgId}/', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(storage.deleteFolder).toHaveBeenCalledWith(`org/${ORG_UUID}`);
    });

    it('deletes database records via repository', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(repo.deleteDatabaseRecords).toHaveBeenCalledWith(ORG_UUID);
    });

    it('clears Redis cache for tenant:{orgId}:*', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(cache.deleteByPattern).toHaveBeenCalledWith(
        `tenant:${ORG_UUID}:*`,
      );
    });

    it('marks organization as DELETED via repository', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(repo.markDeleted).toHaveBeenCalledWith(ORG_UUID);
    });

    it('emits DELETION_COMPLETED event after successful deletion', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

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
      repo.findOrgById.mockResolvedValueOnce(org);

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
      repo.findOrgById.mockResolvedValueOnce(org);
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
      repo.findOrgById.mockResolvedValueOnce(org);
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
      repo.findOrgById.mockResolvedValueOnce(org);
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

    it('uses system triggerType in legal audit for SUBSCRIPTION_EXPIRY trigger', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        'Test Organization',
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.deleted',
          triggerType: 'system',
        }),
      );
    });

    it('calls StripeService when org has a stripeCustomerId', async () => {
      const org = makeOrganization({
        stripeCustomerId: 'cus_123',
        subscriptionId: 'sub_456',
      });
      repo.findOrgById.mockResolvedValueOnce(org);

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      expect(stripeService.terminateSubscription).toHaveBeenCalledWith(
        'sub_456',
      );
      expect(stripeService.deleteCustomer).toHaveBeenCalledWith('cus_123');
    });

    it('enters catch in deleteDatabaseRecords when deleteDatabaseRecords throws', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.deleteDatabaseRecords.mockRejectedValueOnce(
        new Error('DB transaction error'),
      );

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
      expect(failEvent[0].payload.error).toContain('DB transaction error');
    });

    it('stringifies non-Error thrown during deletion (String branch in catch)', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      storage.deleteFolder.mockRejectedValueOnce('plain string error');

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
      expect(failEvent[0].payload.error).toBe('Unknown error');
    });

    it('uses system triggerType in failure legal audit for SUBSCRIPTION_EXPIRY trigger', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      storage.deleteFolder.mockRejectedValueOnce(new Error('S3 error'));

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        'Test Organization',
        requestedAt,
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.deletion.failed',
          triggerType: 'system',
        }),
      );
    });

    it('enters catch in markOrganizationDeleted when markDeleted throws', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.markDeleted.mockRejectedValueOnce(new Error('DB update error'));

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
      expect(failEvent[0].payload.error).toContain('DB update error');
    });
  });

  // ─── revokeExternalResources ─────────────────────────────────────────────────

  describe('revokeExternalResources', () => {
    it('cancels subscription and deletes customer when both are provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).revokeExternalResources('cus_123', 'sub_456');

      expect(stripeService.terminateSubscription).toHaveBeenCalledWith(
        'sub_456',
      );
      expect(stripeService.deleteCustomer).toHaveBeenCalledWith('cus_123');
    });

    it('skips subscription cancel when subscriptionId is null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).revokeExternalResources('cus_123', null);

      expect(stripeService.terminateSubscription).not.toHaveBeenCalled();
      expect(stripeService.deleteCustomer).toHaveBeenCalledWith('cus_123');
    });

    it('skips customer deletion when stripeCustomerId is null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (service as any).revokeExternalResources(null, 'sub_456');

      expect(stripeService.terminateSubscription).toHaveBeenCalledWith(
        'sub_456',
      );
      expect(stripeService.deleteCustomer).not.toHaveBeenCalled();
    });

    it('propagates error when terminateSubscription throws', async () => {
      stripeService.terminateSubscription.mockRejectedValueOnce(
        new Error('already canceled'),
      );

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).revokeExternalResources('cus_123', 'sub_456'),
      ).rejects.toThrow('already canceled');
    });

    it('propagates error when deleteCustomer throws', async () => {
      stripeService.deleteCustomer.mockRejectedValueOnce(
        new Error('already deleted'),
      );

      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (service as any).revokeExternalResources('cus_123', 'sub_456'),
      ).rejects.toThrow('already deleted');
    });
  });

  // ─── sendDeletionConfirmationEmail ─────────────────────────────────────────

  describe('sendDeletionConfirmationEmail (line 90 + lines 198-223)', () => {
    const requestedAt = new Date('2026-01-01');

    it('sends confirmation email when requestedByUserId is set and user is found (line 90)', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.findUserByAuth0Id.mockResolvedValueOnce({ email: 'owner@acme.com' });

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
        'auth0|owner-1', // requestedByUserId — triggers email path
      );

      expect(repo.findUserByAuth0Id).toHaveBeenCalledWith('auth0|owner-1');
      expect(email.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'org-deletion-confirmation',
          recipient: 'owner@acme.com',
        }),
      );
    });

    it('skips email (no abort) when user is not found for auth0Id (line 205)', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.findUserByAuth0Id.mockResolvedValueOnce(null); // user not found

      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
        'auth0|unknown',
      );

      expect(email.sendTransactionalEmail).not.toHaveBeenCalled();
      // Deletion still completes
      expect(repo.deleteDatabaseRecords).toHaveBeenCalledWith(ORG_UUID);
    });

    it('does not abort deletion when email sending throws (lines 217-223)', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.findUserByAuth0Id.mockResolvedValueOnce({ email: 'owner@acme.com' });
      email.sendTransactionalEmail.mockRejectedValueOnce(
        new Error('SMTP error'),
      );

      await expect(
        service.executeDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          'Test Organization',
          requestedAt,
          'auth0|owner-1',
        ),
      ).resolves.not.toThrow();

      // Deletion still completes despite email failure
      expect(repo.deleteDatabaseRecords).toHaveBeenCalledWith(ORG_UUID);
    });

    it('stringifies non-Error email failures (String branch in catch)', async () => {
      const org = makeOrganization();
      repo.findOrgById.mockResolvedValueOnce(org);
      repo.findUserByAuth0Id.mockResolvedValueOnce({ email: 'owner@acme.com' });
      email.sendTransactionalEmail.mockRejectedValueOnce('plain error string');

      await expect(
        service.executeDeletion(
          ORG_UUID,
          DeletionTrigger.USER_REQUEST,
          'Test Organization',
          requestedAt,
          'auth0|owner-1',
        ),
      ).resolves.not.toThrow();
    });
  });
});
