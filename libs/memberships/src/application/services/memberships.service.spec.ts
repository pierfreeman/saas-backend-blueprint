import { MembershipsService } from './memberships.service';
import { MembershipsRepository } from '../../infrastructure/repositories/memberships.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { IMembershipCacheNotifier } from '../../membership-cache-notifier.token';
import { ISeatLimitProvider } from '../../seat-limit-provider.token';
import { Mock, vi } from 'vitest';

const mockActivityLog = {
  logActivity: vi.fn(),
} as unknown as ActivityLogService;
const mockLegalAudit = {
  recordEvent: vi.fn(),
} as unknown as LegalAuditService;
const mockCacheNotifier: IMembershipCacheNotifier = { invalidate: vi.fn() };
const mockSeatLimitProvider: ISeatLimitProvider = { getMaxSeats: vi.fn() };

const mockRepo = {
  countActive: vi.fn(),
  create: vi.fn(),
  findByOrg: vi.fn(),
  findByUser: vi.fn(),
  findById: vi.fn(),
  findByUserAndOrg: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  activateByUserId: vi.fn(),
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
    vi.clearAllMocks();
    service = new MembershipsService(
      mockRepo,
      mockActivityLog,
      mockLegalAudit,
      mockCacheNotifier,
      mockSeatLimitProvider,
    );
  });

  describe('createMembership', () => {
    it('creates a membership and invalidates cache', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(1);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);
      mockCacheNotifier.invalidate = vi.fn().mockResolvedValue(undefined);

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

    it('passes INVITED status to the repository when provided', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(1);
      const invitedMembership = {
        ...baseMembership,
        status: 'INVITED' as MembershipStatus,
      };
      mockRepo.create = vi.fn().mockResolvedValue(invitedMembership);
      mockCacheNotifier.invalidate = vi.fn().mockResolvedValue(undefined);

      const result = await service.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
        status: 'INVITED' as MembershipStatus,
      });

      expect(result).toBe(invitedMembership);
      expect(mockRepo.create).toHaveBeenCalledWith({
        userId: 'u-1',
        orgId: 'org-1',
        role: 'MEMBER',
        status: 'INVITED',
      });
    });

    it('emits legalAudit event with triggerType user_action by default', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(1);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

      await service.createMembership('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'user_action' }),
      );
    });

    it('emits legalAudit event with triggerType admin_action when passed', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(1);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

      await service.createMembership(
        'org-1',
        { userId: 'u-1', role: 'MEMBER' as MembershipRole },
        undefined,
        'admin_action',
      );

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'admin_action' }),
      );
    });
  });

  describe('createMembership — seat limit enforcement', () => {
    it('throws ForbiddenException when active member count reaches the plan limit', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(3);
      mockRepo.countActive = vi.fn().mockResolvedValue(3);

      await expect(
        service.createMembership('org-1', {
          userId: 'u-2',
          role: MembershipRole.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockRepo.countActive).toHaveBeenCalledWith('org-1');
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('allows creation when under the plan seat limit', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(3);
      mockRepo.countActive = vi.fn().mockResolvedValue(2);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

      expect(
        await service.createMembership('org-1', {
          userId: 'u-2',
          role: MembershipRole.MEMBER,
        }),
      ).toBe(baseMembership);
    });

    it('enforces FREE plan limit of 3 seats', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(3);
      mockRepo.countActive = vi.fn().mockResolvedValue(3);

      await expect(
        service.createMembership('org-1', {
          userId: 'u-free',
          role: MembershipRole.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows up to 10 members on PRO plan', async () => {
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(9);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

      await expect(
        service.createMembership('org-1', {
          userId: 'u-pro',
          role: MembershipRole.MEMBER,
        }),
      ).resolves.toBe(baseMembership);
    });

    it('skips seat check when no seatLimitProvider is injected', async () => {
      const serviceWithoutProvider = new MembershipsService(
        mockRepo,
        mockActivityLog,
        mockLegalAudit,
        mockCacheNotifier,
        undefined,
      );
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

      await serviceWithoutProvider.createMembership('org-1', {
        userId: 'u-2',
        role: MembershipRole.MEMBER,
      });

      expect(mockRepo.countActive).not.toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalled();
    });
  });

  describe('findByOrg', () => {
    it('delegates to repository', async () => {
      mockRepo.findByOrg = vi.fn().mockResolvedValue([baseMembership]);
      expect(await service.findByOrg('org-1')).toEqual([baseMembership]);
      expect(mockRepo.findByOrg).toHaveBeenCalledWith('org-1');
    });
  });

  describe('findById', () => {
    it('returns membership when found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      expect(await service.findById('m-1')).toBe(baseMembership);
      expect(mockRepo.findById).toHaveBeenCalledWith('m-1');
    });

    it('returns null when not found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
      expect(await service.findById('m-x')).toBeNull();
    });
  });

  describe('findByUser', () => {
    it('delegates to repository', async () => {
      mockRepo.findByUser = vi.fn().mockResolvedValue([baseMembership]);
      expect(await service.findByUser('u-1')).toEqual([baseMembership]);
    });
  });

  describe('getMembershipOrThrow', () => {
    it('returns membership when found', async () => {
      mockRepo.findByUserAndOrg = vi.fn().mockResolvedValue(baseMembership);
      expect(await service.getMembershipOrThrow('u-1', 'org-1')).toBe(
        baseMembership,
      );
    });

    it('throws ForbiddenException when not found', async () => {
      mockRepo.findByUserAndOrg = vi.fn().mockResolvedValue(null);
      await expect(
        service.getMembershipOrThrow('u-1', 'org-x'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateMembership', () => {
    it('updates role and invalidates cache', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      mockRepo.update = vi.fn().mockResolvedValue(updated);
      mockCacheNotifier.invalidate = vi.fn().mockResolvedValue(undefined);

      const result = await service.updateMembership('m-1', 'org-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(result).toBe(updated);
      expect(mockCacheNotifier.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('emits legalAudit event with triggerType user_action by default', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      mockRepo.update = vi.fn().mockResolvedValue(updated);

      await service.updateMembership('m-1', 'org-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'user_action' }),
      );
    });

    it('emits legalAudit event with triggerType admin_action when passed', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      mockRepo.update = vi.fn().mockResolvedValue(updated);

      await service.updateMembership(
        'm-1',
        'org-1',
        { role: 'ADMIN' as MembershipRole },
        'admin-1',
        'admin_action',
      );

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'admin_action' }),
      );
    });

    it('throws NotFoundException when membership not found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
      await expect(
        service.updateMembership('m-x', 'org-1', {
          role: 'ADMIN' as MembershipRole,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when membership belongs to a different org', async () => {
      mockRepo.findById = vi
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
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      mockRepo.delete = vi.fn().mockResolvedValue(undefined);
      mockCacheNotifier.invalidate = vi.fn().mockResolvedValue(undefined);

      await service.deleteMembership('m-1', 'org-1');

      expect(mockRepo.delete).toHaveBeenCalledWith('m-1');
      expect(mockCacheNotifier.invalidate).toHaveBeenCalledWith('u-1', 'org-1');
    });

    it('emits legalAudit event with triggerType user_action by default', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseMembership);
      mockRepo.delete = vi.fn().mockResolvedValue(undefined);

      await service.deleteMembership('m-1', 'org-1');

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ triggerType: 'user_action' }),
      );
    });

    it('throws NotFoundException when membership not found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
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
        mockSeatLimitProvider,
      );
      (mockSeatLimitProvider.getMaxSeats as Mock).mockResolvedValue(10);
      mockRepo.countActive = vi.fn().mockResolvedValue(1);
      mockRepo.create = vi.fn().mockResolvedValue(baseMembership);

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
      mockRepo.findByUserAndOrg = vi.fn().mockResolvedValue(baseMembership);
      expect(await service.findByUserAndOrg('u-1', 'org-1')).toBe(
        baseMembership,
      );
    });

    it('returns null when not found', async () => {
      mockRepo.findByUserAndOrg = vi.fn().mockResolvedValue(null);
      expect(await service.findByUserAndOrg('u-1', 'org-x')).toBeNull();
    });
  });

  describe('hasRole', () => {
    it('returns true when membership has a matching role', async () => {
      mockRepo.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue({ ...baseMembership, role: MembershipRole.ADMIN });

      const result = await service.hasRole('u-1', 'org-1', [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when membership role is not in the list', async () => {
      mockRepo.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue({ ...baseMembership, role: MembershipRole.MEMBER });

      const result = await service.hasRole('u-1', 'org-1', [
        MembershipRole.OWNER,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when no membership exists', async () => {
      mockRepo.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.hasRole('u-1', 'org-1', [
        MembershipRole.OWNER,
      ]);

      expect(result).toBe(false);
    });
  });

  describe('activateInvitedMemberships', () => {
    it('delegates to repo.activateByUserId', async () => {
      mockRepo.activateByUserId = vi.fn().mockResolvedValue(undefined);

      await service.activateInvitedMemberships('u-1');

      expect(mockRepo.activateByUserId).toHaveBeenCalledWith('u-1');
    });
  });
});
