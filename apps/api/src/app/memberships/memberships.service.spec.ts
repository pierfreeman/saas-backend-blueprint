import { MembershipsService } from './memberships.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { RBACCacheService } from '../rbac/services/rbac-cache.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';

const mockActivityLogService = {
  logActivity: jest.fn(),
} as unknown as ActivityLogService;

const mockLegalAuditService = {
  recordEvent: jest.fn(),
} as unknown as LegalAuditService;


const mockPrisma = {
  membership: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
} as unknown as PrismaBusinessService;

const mockRbacCache = {
  invalidate: jest.fn(),
} as unknown as RBACCacheService;

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
      mockPrisma,
      mockActivityLogService,
      mockLegalAuditService,
      mockRbacCache,
    );
  });

  describe('createMembership', () => {
    it('creates a membership and invalidates RBAC cache', async () => {
      mockPrisma.membership.create = jest
        .fn()
        .mockResolvedValue(baseMembership);
      mockRbacCache.invalidate = jest.fn().mockResolvedValue(undefined);

      const result = await service.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockPrisma.membership.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', orgId: 'org-1', role: 'MEMBER' },
      });
      expect(mockRbacCache.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });
  });

  describe('findByOrg', () => {
    it('returns all memberships for an org', async () => {
      mockPrisma.membership.findMany = jest
        .fn()
        .mockResolvedValue([baseMembership]);
      expect(await service.findByOrg('org-1')).toEqual([baseMembership]);
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        include: { user: true },
      });
    });
  });

  describe('findByUser', () => {
    it('returns all memberships for a user', async () => {
      mockPrisma.membership.findMany = jest
        .fn()
        .mockResolvedValue([baseMembership]);
      const result = await service.findByUser('u-1');
      expect(result).toEqual([baseMembership]);
    });
  });

  describe('getMembershipOrThrow', () => {
    it('returns membership when found', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      expect(await service.getMembershipOrThrow('u-1', 'org-1')).toBe(
        baseMembership,
      );
    });

    it('throws ForbiddenException when not found', async () => {
      mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);
      await expect(
        service.getMembershipOrThrow('u-1', 'org-x'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateMembership', () => {
    it('updates role and invalidates cache', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      mockPrisma.membership.update = jest.fn().mockResolvedValue(updated);
      mockRbacCache.invalidate = jest.fn().mockResolvedValue(undefined);

      const result = await service.updateMembership('m-1', 'org-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(result).toBe(updated);
      expect(mockRbacCache.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('throws NotFoundException when membership not found', async () => {
      mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);
      await expect(
        service.updateMembership('m-x', 'org-1', {
          role: 'ADMIN' as MembershipRole,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when membership belongs to different org', async () => {
      mockPrisma.membership.findUnique = jest
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
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      mockPrisma.membership.delete = jest.fn().mockResolvedValue(undefined);
      mockRbacCache.invalidate = jest.fn().mockResolvedValue(undefined);

      await service.deleteMembership('m-1', 'org-1');
      expect(mockPrisma.membership.delete).toHaveBeenCalledWith({
        where: { id: 'm-1' },
      });
      expect(mockRbacCache.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('throws NotFoundException when membership not found', async () => {
      mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.deleteMembership('m-x', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createMembership — without rbacCache (optional dependency)', () => {
    it('creates membership without calling rbacCache when it is undefined', async () => {
      const serviceWithoutCache = new MembershipsService(
        mockPrisma, mockActivityLogService, mockLegalAuditService, undefined,
      );
      mockPrisma.membership.create = jest
        .fn()
        .mockResolvedValue(baseMembership);

      const result = await serviceWithoutCache.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockRbacCache.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('findByUserAndOrg', () => {
    it('returns membership when found', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      expect(await service.findByUserAndOrg('u-1', 'org-1')).toBe(
        baseMembership,
      );
      expect(mockPrisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'u-1', orgId: 'org-1' } },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);
      expect(await service.findByUserAndOrg('u-1', 'org-x')).toBeNull();
    });
  });

  describe('updateMembership — without rbacCache', () => {
    it('updates role without invalidating cache when rbacCache is undefined', async () => {
      const serviceWithoutCache = new MembershipsService(
        mockPrisma, mockActivityLogService, mockLegalAuditService, undefined,
      );
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      mockPrisma.membership.update = jest.fn().mockResolvedValue(updated);

      const result = await serviceWithoutCache.updateMembership(
        'm-1',
        'org-1',
        {
          role: 'ADMIN' as MembershipRole,
        },
      );
      expect(result).toBe(updated);
      expect(mockRbacCache.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('deleteMembership — without rbacCache', () => {
    it('deletes membership without invalidating cache when rbacCache is undefined', async () => {
      const serviceWithoutCache = new MembershipsService(
        mockPrisma, mockActivityLogService, mockLegalAuditService, undefined,
      );
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      mockPrisma.membership.delete = jest.fn().mockResolvedValue(undefined);

      await serviceWithoutCache.deleteMembership('m-1', 'org-1');
      expect(mockPrisma.membership.delete).toHaveBeenCalledWith({
        where: { id: 'm-1' },
      });
      expect(mockRbacCache.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('hasRole / isOwner / isAdmin', () => {
    it('hasRole returns true when role matches', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      expect(await service.hasRole('u-1', 'org-1', ['MEMBER'])).toBe(true);
    });

    it('hasRole returns false when membership not found', async () => {
      mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);
      expect(await service.hasRole('u-1', 'org-x', ['MEMBER'])).toBe(false);
    });

    it('isOwner returns false for MEMBER', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue(baseMembership);
      expect(await service.isOwner('u-1', 'org-1')).toBe(false);
    });

    it('isAdmin returns true for OWNER', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue({ ...baseMembership, role: 'OWNER' });
      expect(await service.isAdmin('u-1', 'org-1')).toBe(true);
    });

    it('hasRole returns false when role is present but does not match required roles', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue({ ...baseMembership, role: 'MEMBER' });
      expect(await service.hasRole('u-1', 'org-1', ['OWNER', 'ADMIN'])).toBe(
        false,
      );
    });

    it('isOwner returns true when role is OWNER', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue({ ...baseMembership, role: 'OWNER' });
      expect(await service.isOwner('u-1', 'org-1')).toBe(true);
    });

    it('isAdmin returns false for MEMBER', async () => {
      mockPrisma.membership.findUnique = jest
        .fn()
        .mockResolvedValue({ ...baseMembership, role: 'MEMBER' });
      expect(await service.isAdmin('u-1', 'org-1')).toBe(false);
    });
  });
});
