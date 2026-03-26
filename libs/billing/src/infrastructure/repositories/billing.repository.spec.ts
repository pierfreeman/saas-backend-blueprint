import { NotFoundException } from '@nestjs/common';
import { BillingStatus } from '@prisma/client';
import { PrismaBusinessService } from '@libs/prisma-business';
import { Mock, vi } from 'vitest';
import {
  BillingRepository,
  CreateSnapshotInput,
  UpdateBillingDataInput,
} from './billing.repository';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  organization: { update: vi.fn() },
  subscriptionSnapshot: { create: vi.fn() },
};

const mockPrisma = {
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  subscriptionSnapshot: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
  },
  billingEvent: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
} as unknown as PrismaBusinessService;

// ── Shared fixtures ──────────────────────────────────────────────────────────

const orgRow = {
  id: 'org-1',
  stripeCustomerId: 'cus_001',
  subscriptionId: 'sub_001',
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  storageLimit: BigInt(1073741824),
  subscriptionPeriodStart: new Date('2026-01-01'),
  subscriptionPeriodEnd: new Date('2026-02-01'),
  cancelAtPeriodEnd: false,
};

const snapshotInput: CreateSnapshotInput = {
  orgId: 'org-1',
  stripeSubscriptionId: 'sub_001',
  planId: 'price_pro',
  status: 'active',
  seats: 3,
  seatLimit: null,
  periodStart: new Date('2026-01-01'),
  periodEnd: new Date('2026-02-01'),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BillingRepository', () => {
  let repo: BillingRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new BillingRepository(mockPrisma);
  });

  // ── findOrgById ────────────────────────────────────────────────────────────

  describe('findOrgById', () => {
    it('returns a mapped SubscriptionEntity when org exists', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(orgRow);

      const result = await repo.findOrgById('org-1');

      expect(result.orgId).toBe('org-1');
      expect(result.stripeCustomerId).toBe('cus_001');
      expect(result.billingStatus).toBe(BillingStatus.ACTIVE);
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(null);

      await expect(repo.findOrgById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── findOrgByStripeCustomerId ──────────────────────────────────────────────

  describe('findOrgByStripeCustomerId', () => {
    it('returns mapped entity when found', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(orgRow);

      const result = await repo.findOrgByStripeCustomerId('cus_001');

      expect(result).not.toBeNull();
      expect(result!.orgId).toBe('org-1');
      expect(result!.stripeCustomerId).toBe('cus_001');
    });

    it('returns null when no org matches the customer ID', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findOrgByStripeCustomerId('cus_unknown');
      expect(result).toBeNull();
    });
  });

  // ── updateOrgBillingData ───────────────────────────────────────────────────

  describe('updateOrgBillingData', () => {
    it('calls prisma.organization.update with only provided fields', async () => {
      mockPrisma.organization.update = vi.fn().mockResolvedValue({});

      const input: UpdateBillingDataInput = {
        billingStatus: BillingStatus.PAST_DUE,
        cancelAtPeriodEnd: true,
      };

      await repo.updateOrgBillingData('org-1', input);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-1' },
          data: expect.objectContaining({
            billingStatus: BillingStatus.PAST_DUE,
            cancelAtPeriodEnd: true,
          }),
        }),
      );
    });

    it('omits undefined fields from the update payload', async () => {
      mockPrisma.organization.update = vi.fn().mockResolvedValue({});

      await repo.updateOrgBillingData('org-1', { planId: 'price_pro' });

      const call = (mockPrisma.organization.update as Mock).mock
        .calls[0][0];
      expect(call.data).not.toHaveProperty('billingStatus');
      expect(call.data).toHaveProperty('planId', 'price_pro');
    });

    it('can null out subscriptionId and planId', async () => {
      mockPrisma.organization.update = vi.fn().mockResolvedValue({});

      await repo.updateOrgBillingData('org-1', {
        subscriptionId: null,
        planId: null,
      });

      const call = (mockPrisma.organization.update as Mock).mock
        .calls[0][0];
      expect(call.data.subscriptionId).toBeNull();
      expect(call.data.planId).toBeNull();
    });
  });

  // ── createSubscriptionSnapshot ─────────────────────────────────────────────

  describe('createSubscriptionSnapshot', () => {
    it('calls prisma.subscriptionSnapshot.create with correct data', async () => {
      mockPrisma.subscriptionSnapshot.create = vi.fn().mockResolvedValue({});

      await repo.createSubscriptionSnapshot(snapshotInput);

      expect(mockPrisma.subscriptionSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orgId: 'org-1',
          stripeSubscriptionId: 'sub_001',
          planId: 'price_pro',
          status: 'active',
        }),
      });
    });
  });

  // ── updateOrgAndSnapshotTx ─────────────────────────────────────────────────

  describe('updateOrgAndSnapshotTx', () => {
    it('runs both writes within a $transaction', async () => {
      mockTx.organization.update.mockResolvedValue({});
      mockTx.subscriptionSnapshot.create.mockResolvedValue({});
      (mockPrisma.$transaction as Mock).mockImplementation(
        (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx),
      );

      await repo.updateOrgAndSnapshotTx(
        'org-1',
        { billingStatus: BillingStatus.ACTIVE },
        snapshotInput,
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.organization.update).toHaveBeenCalledTimes(1);
      expect(mockTx.subscriptionSnapshot.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── findSnapshotsByOrgId ───────────────────────────────────────────────────

  describe('findSnapshotsByOrgId', () => {
    const snap = {
      id: 'snap-1',
      stripeSubscriptionId: 'sub_001',
      planId: 'price_pro',
      status: 'active',
      seats: 3,
      seatLimit: null,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-02-01'),
      createdAt: new Date(),
    };

    it('returns items and total using $transaction', async () => {
      (mockPrisma.$transaction as Mock).mockResolvedValue([[snap], 1]);

      const result = await repo.findSnapshotsByOrgId('org-1', 10, 0);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('returns empty list when no snapshots exist', async () => {
      (mockPrisma.$transaction as Mock).mockResolvedValue([[], 0]);

      const result = await repo.findSnapshotsByOrgId('org-1', 10, 0);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ── findBillingEvent ───────────────────────────────────────────────────────

  describe('findBillingEvent', () => {
    it('returns the event record when found', async () => {
      mockPrisma.billingEvent.findUnique = vi
        .fn()
        .mockResolvedValue({ id: 'be-1' });

      const result = await repo.findBillingEvent('evt_001');
      expect(result).toEqual({ id: 'be-1' });
    });

    it('returns null when event not found', async () => {
      mockPrisma.billingEvent.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findBillingEvent('evt_unknown');
      expect(result).toBeNull();
    });
  });

  // ── createBillingEvent ─────────────────────────────────────────────────────

  describe('createBillingEvent', () => {
    it('creates a billing event record', async () => {
      mockPrisma.billingEvent.create = vi.fn().mockResolvedValue({});

      await repo.createBillingEvent('evt_001', 'hash_abc', 'org-1');

      expect(mockPrisma.billingEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          stripeEventId: 'evt_001',
          payloadHash: 'hash_abc',
          orgId: 'org-1',
        }),
      });
    });

    it('creates a billing event without orgId when not provided', async () => {
      mockPrisma.billingEvent.create = vi.fn().mockResolvedValue({});

      await repo.createBillingEvent('evt_002', 'hash_xyz');

      const call = (mockPrisma.billingEvent.create as Mock).mock
        .calls[0][0];
      expect(call.data).not.toHaveProperty('orgId');
    });

    it('silently ignores unique constraint violations (race condition)', async () => {
      mockPrisma.billingEvent.create = vi
        .fn()
        .mockRejectedValue(new Error('Unique constraint failed'));

      await expect(
        repo.createBillingEvent('evt_dup', 'hash_dup'),
      ).resolves.not.toThrow();
    });

    it('rethrows non-unique-constraint errors', async () => {
      mockPrisma.billingEvent.create = vi
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));

      await expect(
        repo.createBillingEvent('evt_err', 'hash_err'),
      ).rejects.toThrow('Connection timeout');
    });
  });
});
