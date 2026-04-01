import { vi } from 'vitest';
import {
  OrgDeletionRepository,
  MarkPendingDeletionInput,
} from './org-deletion.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { OrganizationStatus } from '@libs/prisma-business';

// ─── Prisma mock ─────────────────────────────────────────────────────────────

function buildTx() {
  return {
    subscriptionSnapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    event: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    file: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    orgExport: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    job: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    activityLog: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    membership: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
}

function buildMockPrisma() {
  const tx = buildTx();
  return {
    organization: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof tx) => Promise<void>) => {
      await cb(tx);
    }),
    __tx: tx,
  };
}

const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

describe('OrgDeletionRepository', () => {
  let repo: OrgDeletionRepository;
  let mockPrisma: ReturnType<typeof buildMockPrisma>;

  beforeEach(() => {
    mockPrisma = buildMockPrisma();
    repo = new OrgDeletionRepository(
      mockPrisma as unknown as PrismaBusinessService,
    );
  });

  afterEach(() => vi.clearAllMocks());

  // ── findOrgById ────────────────────────────────────────────────────────────

  describe('findOrgById', () => {
    it('returns the org record when found', async () => {
      const org = {
        id: ORG_UUID,
        name: 'Acme',
        status: OrganizationStatus.ACTIVE,
        retentionPeriodDays: 30,
        stripeCustomerId: 'cus_1',
        subscriptionId: 'sub_1',
      };
      mockPrisma.organization.findUnique.mockResolvedValue(org);

      const result = await repo.findOrgById(ORG_UUID);

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: ORG_UUID },
        select: {
          id: true,
          name: true,
          status: true,
          retentionPeriodDays: true,
          stripeCustomerId: true,
          subscriptionId: true,
        },
      });
      expect(result).toEqual(org);
    });

    it('returns null when org is not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      const result = await repo.findOrgById('unknown-id');
      expect(result).toBeNull();
    });
  });

  // ── findOrgsEligibleForDeletion ────────────────────────────────────────────

  describe('findOrgsEligibleForDeletion', () => {
    it('queries for SUSPENDED orgs with deletionScheduledAt <= now', async () => {
      const now = new Date('2026-01-15');
      mockPrisma.organization.findMany.mockResolvedValue([]);

      const result = await repo.findOrgsEligibleForDeletion(now);

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith({
        where: {
          status: 'SUSPENDED',
          deletionScheduledAt: { lte: now },
        },
      });
      expect(result).toEqual([]);
    });

    it('returns matching organizations', async () => {
      const org = { id: ORG_UUID, name: 'Acme', status: 'SUSPENDED' };
      mockPrisma.organization.findMany.mockResolvedValue([org]);

      const result = await repo.findOrgsEligibleForDeletion(new Date());
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ORG_UUID);
    });
  });

  // ── findSuspendedOrgsWithExpiredSubscriptions ──────────────────────────────

  describe('findSuspendedOrgsWithExpiredSubscriptions', () => {
    it('queries for SUSPENDED orgs with subscriptionPeriodEnd in the past', async () => {
      const now = new Date('2026-01-15');
      mockPrisma.organization.findMany.mockResolvedValue([]);

      await repo.findSuspendedOrgsWithExpiredSubscriptions(now);

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith({
        where: {
          status: OrganizationStatus.SUSPENDED,
          subscriptionPeriodEnd: { not: null, lt: now },
        },
        select: {
          id: true,
          name: true,
          subscriptionPeriodEnd: true,
          retentionPeriodDays: true,
        },
      });
    });

    it('returns found records', async () => {
      const row = {
        id: ORG_UUID,
        name: 'Acme',
        subscriptionPeriodEnd: new Date('2025-12-01'),
        retentionPeriodDays: 30,
      };
      mockPrisma.organization.findMany.mockResolvedValue([row]);

      const result = await repo.findSuspendedOrgsWithExpiredSubscriptions(
        new Date(),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ORG_UUID);
    });
  });

  // ── markPendingDeletion ────────────────────────────────────────────────────

  describe('markPendingDeletion', () => {
    it('updates status to PENDING_DELETION with timestamps', async () => {
      const input: MarkPendingDeletionInput = {
        deletionRequestedAt: new Date('2026-01-01'),
        deletionScheduledAt: new Date('2026-01-31'),
      };

      await repo.markPendingDeletion(ORG_UUID, input);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG_UUID },
        data: {
          status: OrganizationStatus.PENDING_DELETION,
          deletionRequestedAt: input.deletionRequestedAt,
          deletionScheduledAt: input.deletionScheduledAt,
        },
      });
    });
  });

  // ── markDeleted ────────────────────────────────────────────────────────────

  describe('markDeleted', () => {
    it('sets status to DELETED and sets deletionCompletedAt', async () => {
      const before = new Date();
      await repo.markDeleted(ORG_UUID);
      const after = new Date();

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG_UUID },
        data: expect.objectContaining({
          status: OrganizationStatus.DELETED,
          deletionCompletedAt: expect.any(Date),
        }),
      });

      const [{ data }] = mockPrisma.organization.update.mock.calls[0];
      expect(data.deletionCompletedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(data.deletionCompletedAt.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
    });
  });

  // ── findUserByAuth0Id ──────────────────────────────────────────────────────

  describe('findUserByAuth0Id', () => {
    it('returns email when user is found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' });

      const result = await repo.findUserByAuth0Id('auth0|123');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|123' },
        select: { email: true },
      });
      expect(result).toEqual({ email: 'a@b.com' });
    });

    it('returns null when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await repo.findUserByAuth0Id('auth0|unknown');
      expect(result).toBeNull();
    });
  });

  // ── deleteDatabaseRecords ──────────────────────────────────────────────────

  describe('deleteDatabaseRecords', () => {
    it('runs a transaction deleting all child entities in order', async () => {
      await repo.deleteDatabaseRecords(ORG_UUID);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      const tx = mockPrisma.__tx;
      expect(tx.subscriptionSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.event.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.file.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.notification.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.orgExport.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.job.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.activityLog.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
      expect(tx.membership.deleteMany).toHaveBeenCalledWith({
        where: { orgId: ORG_UUID },
      });
    });
  });
});
