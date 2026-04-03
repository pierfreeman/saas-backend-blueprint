import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AdminBillingRepository } from './admin-billing.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { BillingStatus } from '@libs/prisma-business';

const mockOrgBillingFields = {
  id: 'org-1',
  stripeCustomerId: 'cus_abc',
  subscriptionId: 'sub_xyz',
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  storageLimit: BigInt(5 * 1024 * 1024 * 1024),
  subscriptionPeriodStart: new Date('2024-01-01'),
  subscriptionPeriodEnd: new Date('2025-01-01'),
  cancelAtPeriodEnd: false,
};

describe('AdminBillingRepository', () => {
  let repository: AdminBillingRepository;

  const mockPrisma = {
    organization: {
      findUnique: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBillingRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(AdminBillingRepository);
  });

  // ── findOrgBillingFields ──────────────────────────────────────────────────

  describe('findOrgBillingFields', () => {
    it('returns billing fields when org exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(
        mockOrgBillingFields,
      );

      const result = await repository.findOrgBillingFields('org-1');

      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        select: {
          id: true,
          stripeCustomerId: true,
          subscriptionId: true,
          billingStatus: true,
          planId: true,
          storageLimit: true,
          subscriptionPeriodStart: true,
          subscriptionPeriodEnd: true,
          cancelAtPeriodEnd: true,
        },
      });
      expect(result).toEqual(mockOrgBillingFields);
    });

    it('returns null when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      const result = await repository.findOrgBillingFields(
        '00000000-0000-0000-0000-000000000000',
      );

      expect(result).toBeNull();
    });
  });
});
