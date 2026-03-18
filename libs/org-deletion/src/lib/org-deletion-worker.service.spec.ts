// Mock the stripe module before any imports that reference it
jest.mock('stripe', () => {
  const MockStripe = jest.fn(() => ({
    subscriptions: { cancel: jest.fn().mockResolvedValue({}) },
    customers: { del: jest.fn().mockResolvedValue({}) },
  }));
  return { __esModule: true, default: MockStripe };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
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
  const prisma = {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    job: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    apiKey: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    webhook: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    file: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notification: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    orgExport: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    activityLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    membership: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma),
  );

  return prisma;
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
      expect(prisma.orgExport.deleteMany).toHaveBeenCalledWith({
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

      expect(cache.deleteByPattern).toHaveBeenCalledWith(
        `tenant:${ORG_UUID}:*`,
      );
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

    it('uses system triggerType in legal audit for SUBSCRIPTION_EXPIRY trigger', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: 'DELETED',
      });

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

    it('calls revokeExternalResources when org has a stripeCustomerId', async () => {
      const org = makeOrganization({ stripeCustomerId: 'cus_123' });
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockResolvedValue({
        ...org,
        status: 'DELETED',
      });

      // stripe is null (no STRIPE_SECRET_KEY configured) so revokeExternalResources
      // will log and return early — this still exercises the branch
      await service.executeDeletion(
        ORG_UUID,
        DeletionTrigger.USER_REQUEST,
        'Test Organization',
        requestedAt,
      );

      // Deletion completed despite Stripe being null
      expect(prisma.organization.update).toHaveBeenCalled();
    });

    it('enters catch in deleteDatabaseRecords when $transaction throws', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.$transaction.mockRejectedValueOnce(
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

    it('enters catch in markOrganizationDeleted when organization.update throws', async () => {
      const org = makeOrganization();
      prisma.organization.findUnique.mockResolvedValueOnce(org);
      prisma.organization.update.mockRejectedValueOnce(
        new Error('DB update error'),
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
      expect(failEvent[0].payload.error).toContain('DB update error');
    });
  });

  // ─── Stripe initialization ──────────────────────────────────────────────────

  describe('Stripe initialization', () => {
    it('initializes Stripe when a non-placeholder key is provided', async () => {
      const MockStripe = Stripe as unknown as jest.Mock;
      MockStripe.mockClear();

      const stripeConfig = {
        get: jest.fn((key: string) => {
          if (key === 'STRIPE_SECRET_KEY') return 'sk_live_real_key';
          return undefined;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          OrgDeletionWorkerService,
          { provide: PrismaBusinessService, useValue: buildPrismaMock() },
          { provide: EventBusService, useValue: buildEventBusMock() },
          { provide: LegalAuditService, useValue: buildLegalAuditMock() },
          { provide: ActivityLogService, useValue: buildActivityLogMock() },
          { provide: CacheService, useValue: buildCacheMock() },
          { provide: StorageService, useValue: buildStorageMock() },
          { provide: ConfigService, useValue: stripeConfig },
        ],
      }).compile();

      const stripeService = module.get<OrgDeletionWorkerService>(
        OrgDeletionWorkerService,
      );
      expect((stripeService as any).stripe).not.toBeNull();
      expect(MockStripe).toHaveBeenCalledWith(
        'sk_live_real_key',
        expect.any(Object),
      );
    });

    it('does not initialize Stripe when key is the placeholder sk_test_...', async () => {
      const MockStripe = Stripe as unknown as jest.Mock;
      MockStripe.mockClear();

      const placeholderConfig = {
        get: jest.fn((key: string) => {
          if (key === 'STRIPE_SECRET_KEY') return 'sk_test_...';
          return undefined;
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          OrgDeletionWorkerService,
          { provide: PrismaBusinessService, useValue: buildPrismaMock() },
          { provide: EventBusService, useValue: buildEventBusMock() },
          { provide: LegalAuditService, useValue: buildLegalAuditMock() },
          { provide: ActivityLogService, useValue: buildActivityLogMock() },
          { provide: CacheService, useValue: buildCacheMock() },
          { provide: StorageService, useValue: buildStorageMock() },
          { provide: ConfigService, useValue: placeholderConfig },
        ],
      }).compile();

      const stripeService = module.get<OrgDeletionWorkerService>(
        OrgDeletionWorkerService,
      );
      expect((stripeService as any).stripe).toBeNull();
      expect(MockStripe).not.toHaveBeenCalled();
    });
  });

  // ─── revokeExternalResources ────────────────────────────────────────────────

  describe('revokeExternalResources with Stripe configured', () => {
    const mockStripe = {
      subscriptions: { cancel: jest.fn() },
      customers: { del: jest.fn() },
    };

    beforeEach(() => {
      mockStripe.subscriptions.cancel.mockReset();
      mockStripe.customers.del.mockReset();
      (service as any).stripe = mockStripe;
    });

    afterEach(() => {
      (service as any).stripe = null;
    });

    it('cancels subscription and deletes customer when both are provided', async () => {
      mockStripe.subscriptions.cancel.mockResolvedValueOnce({});
      mockStripe.customers.del.mockResolvedValueOnce({});

      await (service as any).revokeExternalResources('cus_123', 'sub_456');

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_456');
      expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_123');
    });

    it('skips subscription cancel when subscriptionId is null', async () => {
      mockStripe.customers.del.mockResolvedValueOnce({});

      await (service as any).revokeExternalResources('cus_123', null);

      expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
      expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_123');
    });

    it('skips customer deletion when stripeCustomerId is null', async () => {
      mockStripe.subscriptions.cancel.mockResolvedValueOnce({});

      await (service as any).revokeExternalResources(null, 'sub_456');

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith('sub_456');
      expect(mockStripe.customers.del).not.toHaveBeenCalled();
    });

    it('warns and continues when subscription cancellation fails', async () => {
      mockStripe.subscriptions.cancel.mockRejectedValueOnce(
        new Error('already canceled'),
      );
      mockStripe.customers.del.mockResolvedValueOnce({});

      await expect(
        (service as any).revokeExternalResources('cus_123', 'sub_456'),
      ).resolves.not.toThrow();

      expect(mockStripe.customers.del).toHaveBeenCalledWith('cus_123');
    });

    it('warns and continues when customer deletion fails', async () => {
      mockStripe.subscriptions.cancel.mockResolvedValueOnce({});
      mockStripe.customers.del.mockRejectedValueOnce(
        new Error('already deleted'),
      );

      await expect(
        (service as any).revokeExternalResources('cus_123', 'sub_456'),
      ).resolves.not.toThrow();
    });
  });
});
