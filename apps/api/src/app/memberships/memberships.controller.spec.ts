import { MembershipsController } from './memberships.controller';
import { MembershipsService } from '@libs/memberships';
import { RBACCacheService } from '@libs/rbac';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { InviteMemberService } from './invite-member.service';
import { RemoveMemberService } from './remove-member.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

const mockMembershipsService = {
  createMembership: vi.fn(),
  findByOrg: vi.fn(),
  updateMembership: vi.fn(),
  deleteMembership: vi.fn(),
} as unknown as MembershipsService;

const mockRBACCacheService = {
  invalidate: vi.fn().mockResolvedValue(undefined),
  invalidateOrg: vi.fn().mockResolvedValue(undefined),
} as unknown as RBACCacheService;

const mockInviteMemberService = {
  invite: vi.fn(),
} as unknown as InviteMemberService;

const mockRemoveMemberService = {
  remove: vi.fn(),
} as unknown as RemoveMemberService;

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: 'MEMBER' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MembershipsController', () => {
  let controller: MembershipsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MembershipsController(
      mockMembershipsService,
      mockRBACCacheService,
      mockInviteMemberService,
      mockRemoveMemberService,
    );
  });

  describe('create()', () => {
    it('creates a membership and returns the result', async () => {
      mockMembershipsService.createMembership = vi
        .fn()
        .mockResolvedValue(baseMembership);

      const result = await controller.create('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        { userId: 'u-1', role: 'MEMBER' },
      );
    });

    it('propagates errors from the service', async () => {
      mockMembershipsService.createMembership = vi
        .fn()
        .mockRejectedValue(new Error('Duplicate membership'));

      await expect(
        controller.create('org-1', {
          userId: 'u-1',
          role: 'MEMBER' as MembershipRole,
        }),
      ).rejects.toThrow('Duplicate membership');
    });
  });

  describe('findByOrg()', () => {
    it('returns the list of memberships for an org', async () => {
      const list = [baseMembership, { ...baseMembership, id: 'm-2' }];
      mockMembershipsService.findByOrg = vi.fn().mockResolvedValue(list);

      const result = await controller.findByOrg('org-1');
      expect(result).toBe(list);
      expect(mockMembershipsService.findByOrg).toHaveBeenCalledWith('org-1');
    });

    it('returns an empty array when the org has no members', async () => {
      mockMembershipsService.findByOrg = vi.fn().mockResolvedValue([]);
      expect(await controller.findByOrg('org-empty')).toEqual([]);
    });
  });

  describe('update()', () => {
    it('updates a membership role and returns the updated entity', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockMembershipsService.updateMembership = vi
        .fn()
        .mockResolvedValue(updated);

      const result = await controller.update('org-1', 'm-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(result).toBe(updated);
      expect(mockMembershipsService.updateMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        { role: 'ADMIN' },
      );
    });

    it('propagates NotFoundException from service', async () => {
      mockMembershipsService.updateMembership = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(
        controller.update('org-1', 'm-x', { role: 'ADMIN' as MembershipRole }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete()', () => {
    it('delegates to RemoveMemberService and returns success message', async () => {
      mockRemoveMemberService.remove = vi.fn().mockResolvedValue(undefined);

      const result = await controller.delete('org-1', 'm-1', 'actor-id');

      expect(result).toEqual({ message: 'Membership deleted successfully' });
      expect(mockRemoveMemberService.remove).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        'actor-id',
      );
      expect(mockRBACCacheService.invalidateOrg).toHaveBeenCalledWith('org-1');
    });

    it('propagates NotFoundException from RemoveMemberService', async () => {
      mockRemoveMemberService.remove = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(
        controller.delete('org-1', 'm-x', 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invite()', () => {
    const inviteDto = {
      email: 'alice@example.com',
      role: 'MEMBER' as MembershipRole,
    };
    const inviterUserId = 'inviter-db-id';

    it('delegates to InviteMemberService and returns the result', async () => {
      const expected = { message: 'Invitation sent successfully.' };
      mockInviteMemberService.invite = vi.fn().mockResolvedValue(expected);

      const result = await controller.invite('org-1', inviteDto, inviterUserId);

      expect(result).toBe(expected);
      expect(mockInviteMemberService.invite).toHaveBeenCalledWith(
        inviteDto,
        'org-1',
        inviterUserId,
      );
    });

    it('propagates ConflictException when user is already a member', async () => {
      mockInviteMemberService.invite = vi
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'alice@example.com is already a member of this organization.',
          ),
        );

      await expect(
        controller.invite('org-1', inviteDto, inviterUserId),
      ).rejects.toThrow(ConflictException);
    });
  });
});
