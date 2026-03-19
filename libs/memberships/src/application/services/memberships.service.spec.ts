import { MembershipsService } from './memberships.service';
import { MembershipsRepository } from '../../infrastructure/repositories/memberships.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import {
  BillingStatus,
  MembershipRole,
  MembershipStatus,
} from '@prisma/client';
import { IMembershipCacheNotifier } from '../../membership-cache-notifier.token';

const mockActivityLog = {
  logActivity: jest.fn(),
} as unknown as ActivityLogService;
const mockLegalAudit = {
  recordEvent: jest.fn(),
} as unknown as LegalAuditService;
const mockCacheNotifier: IMembershipCacheNotifier = { invalidate: jest.fn() };

const mockRepo = {
  findOrgSeatInfo: jest.fn(),
  countActive: jest.fn(),
  create: jest.fn(),
  findByOrg: jest.fn(),
  findByUser: jest.fn(),
  findById: jest.fn(),
  findByUserAndOrg: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
} as unknown as MembershipsRepository;

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: 'MEMBER' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MembershipsService', () => {
  let service: MembershipsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MembershipsService(
      mockRepo,
      mockActivityLog,
      mockLegalAudit,
      mockCacheNotifier,
    );
  });

  describe('createMembership', () => {
    it('creates a membership and invalidates cache', async () => {
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({ billingStatus: BillingStatus.NONE, seatCount: 1 });
      mockRepo.create = jest.fn().mockResolvedValue(baseMembership);
      mockCacheNotifier.invalidate = jest.fn().mockResolvedValue(undefined);

      const result = await service.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockRepo.create).toHaveBeenCalledWith({
        userId: 'u-1',
        orgId: 'org-1',
        role: 'MEMBER',
      });
      expect(mockCacheNotifier.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });
  });

  describe('createMembership — seat limit enforcement', () => {
    it('throws ForbiddenException when seat count is reached on paid plan', async () => {
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({
          billingStatus: BillingStatus.ACTIVE,
          seatCount: 3,
        });
      mockRepo.countActive = jest.fn().mockResolvedValue(3);

      await expect(
        service.createMembership('org-1', {
          userId: 'u-2',
          role: MembershipRole.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRepo.countActive).toHaveBeenCalledWith('org-1');
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('allows creation when under seat limit', async () => {
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({
          billingStatus: BillingStatus.ACTIVE,
          seatCount: 3,
        });
      mockRepo.countActive = jest.fn().mockResolvedValue(2);
      mockRepo.create = jest.fn().mockResolvedValue(baseMembership);

      expect(
        await service.createMembership('org-1', {
          userId: 'u-2',
          role: MembershipRole.MEMBER,
        }),
      ).toBe(baseMembership);
    });

    it('skips seat check when billingStatus is NONE (free tier)', async () => {
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({ billingStatus: BillingStatus.NONE, seatCount: 1 });
      mockRepo.create = jest.fn().mockResolvedValue(baseMembership);

      await service.createMembership('org-1', {
        userId: 'u-2',
        role: MembershipRole.MEMBER,
      });

      expect(mockRepo.countActive).not.toHaveBeenCalled();
    });

    it('skips seat check when org is not found', async () => {
      mockRepo.findOrgSeatInfo = jest.fn().mockResolvedValue(null);
      mockRepo.create = jest.fn().mockResolvedValue(baseMembership);

      await service.createMembership('org-1', {
        userId: 'u-2',
        role: MembershipRole.MEMBER,
      });

      expect(mockRepo.countActive).not.toHaveBeenCalled();
    });

    it('enforces seat limit when billingStatus is TRIALING', async () => {
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({
          billingStatus: BillingStatus.TRIALING,
          seatCount: 2,
        });
      mockRepo.countActive = jest.fn().mockResolvedValue(2);

      await expect(
        service.createMembership('org-1', {
          userId: 'u-2',
          role: MembershipRole.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findByOrg', () => {
    it('delegates to repository', async () => {
      mockRepo.findByOrg = jest.fn().mockResolvedValue([baseMembership]);
      expect(await service.findByOrg('org-1')).toEqual([baseMembership]);
      expect(mockRepo.findByOrg).toHaveBeenCalledWith('org-1');
    });
  });

  describe('findByUser', () => {
    it('delegates to repository', async () => {
      mockRepo.findByUser = jest.fn().mockResolvedValue([baseMembership]);
      expect(await service.findByUser('u-1')).toEqual([baseMembership]);
    });
  });

  describe('getMembershipOrThrow', () => {
    it('returns membership when found', async () => {
      mockRepo.findByUserAndOrg = jest.fn().mockResolvedValue(baseMembership);
      expect(await service.getMembershipOrThrow('u-1', 'org-1')).toBe(
        baseMembership,
      );
    });

    it('throws ForbiddenException when not found', async () => {
      mockRepo.findByUserAndOrg = jest.fn().mockResolvedValue(null);
      await expect(
        service.getMembershipOrThrow('u-1', 'org-x'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateMembership', () => {
    it('updates role and invalidates cache', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockRepo.findById = jest.fn().mockResolvedValue(baseMembership);
      mockRepo.update = jest.fn().mockResolvedValue(updated);
      mockCacheNotifier.invalidate = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateMembership('m-1', 'org-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(result).toBe(updated);
      expect(mockCacheNotifier.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('throws NotFoundException when membership not found', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(
        service.updateMembership('m-x', 'org-1', {
          role: 'ADMIN' as MembershipRole,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when membership belongs to a different org', async () => {
      mockRepo.findById = jest
        .fn()
        .mockResolvedValue({ ...baseMembership, orgId: 'org-other' });
      await expect(
        service.updateMembership('m-1', 'org-1', {
          role: 'ADMIN' as MembershipRole,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMembership', () => {
    it('deletes membership and invalidates cache', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(baseMembership);
      mockRepo.delete = jest.fn().mockResolvedValue(undefined);
      mockCacheNotifier.invalidate = jest.fn().mockResolvedValue(undefined);

      await service.deleteMembership('m-1', 'org-1');

      expect(mockRepo.delete).toHaveBeenCalledWith('m-1');
      expect(mockCacheNotifier.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('throws NotFoundException when membership not found', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.deleteMembership('m-x', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('without cacheNotifier (optional dependency)', () => {
    it('creates membership without calling cache when notifier is undefined', async () => {
      const serviceWithoutCache = new MembershipsService(
        mockRepo,
        mockActivityLog,
        mockLegalAudit,
        undefined,
      );
      mockRepo.findOrgSeatInfo = jest
        .fn()
        .mockResolvedValue({ billingStatus: BillingStatus.NONE, seatCount: 1 });
      mockRepo.create = jest.fn().mockResolvedValue(baseMembership);

      const result = await serviceWithoutCache.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockCacheNotifier.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('findByUserAndOrg', () => {
    it('returns membership when found', async () => {
      mockRepo.findByUserAndOrg = jest.fn().mockResolvedValue(baseMembership);
      expect(await service.findByUserAndOrg('u-1', 'org-1')).toBe(
        baseMembership,
      );
    });

    it('returns null when not found', async () => {
      mockRepo.findByUserAndOrg = jest.fn().mockResolvedValue(null);
      expect(await service.findByUserAndOrg('u-1', 'org-x')).toBeNull();
    });
  });
});
