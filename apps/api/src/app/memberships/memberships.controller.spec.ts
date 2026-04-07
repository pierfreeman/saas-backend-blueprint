import { MembershipsController } from './memberships.controller';
import { MembershipsService } from '@libs/memberships';
import { RBACCacheService } from '@libs/rbac';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { InviteMemberService } from '@libs/memberships';
import { RemoveMemberService } from '@libs/memberships';
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

      const result = await controller.update(
        'org-1',
        'm-1',
        {
          role: 'ADMIN' as MembershipRole,
        },
        undefined,
      );

      expect(result).toBe(updated);
      expect(mockMembershipsService.updateMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        { role: 'ADMIN' },
        undefined,
      );
    });

    it('propagates NotFoundException from service', async () => {
      mockMembershipsService.updateMembership = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(
        controller.update(
          'org-1',
          'm-x',
          { role: 'ADMIN' as MembershipRole },
          undefined,
        ),
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
        inviteDto.email,
        inviteDto.role,
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

  describe('update() with CurrentUserId', () => {
    it('passes the inviterUserId to updateMembership', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockMembershipsService.updateMembership = vi
        .fn()
        .mockResolvedValue(updated);

      const result = await controller.update(
        'org-1',
        'm-1',
        { role: 'ADMIN' as MembershipRole },
        'inviter-user-id',
      );

      expect(result).toBe(updated);
      expect(mockMembershipsService.updateMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        { role: 'ADMIN' },
        'inviter-user-id',
      );
      expect(mockRBACCacheService.invalidate).toHaveBeenCalledWith(
        baseMembership.userId,
        baseMembership.orgId,
      );
    });

    it('invalidates RBAC cache after successful update', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockMembershipsService.updateMembership = vi
        .fn()
        .mockResolvedValue(updated);

      await controller.update(
        'org-1',
        'm-1',
        { role: 'ADMIN' as MembershipRole },
        'inviter-user-id',
      );

      expect(mockRBACCacheService.invalidate).toHaveBeenCalledWith(
        updated.userId,
        updated.orgId,
      );
    });
  });

  describe('invite() with CurrentUserId', () => {
    const inviteDto = {
      email: 'bob@example.com',
      role: 'MEMBER' as MembershipRole,
    };

    it('passes the inviterUserId to InviteMemberService.invite', async () => {
      const expected = { message: 'Invitation sent successfully.' };
      mockInviteMemberService.invite = vi.fn().mockResolvedValue(expected);

      const result = await controller.invite(
        'org-1',
        inviteDto,
        'inviter-user-db-id',
      );

      expect(result).toBe(expected);
      expect(mockInviteMemberService.invite).toHaveBeenCalledWith(
        inviteDto.email,
        inviteDto.role,
        'org-1',
        'inviter-user-db-id',
      );
    });

    it('returns success message from InviteMemberService', async () => {
      const expected = { message: 'Invitation sent successfully.' };
      mockInviteMemberService.invite = vi.fn().mockResolvedValue(expected);

      const result = await controller.invite('org-1', inviteDto, 'inviter-id');

      expect(result).toEqual(expected);
    });

    it('propagates errors from InviteMemberService', async () => {
      mockInviteMemberService.invite = vi
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'bob@example.com is already a member of this organization.',
          ),
        );

      await expect(
        controller.invite('org-1', inviteDto, 'inviter-id'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('delete() with CurrentUserId', () => {
    it('passes actorUserId to RemoveMemberService.remove', async () => {
      mockRemoveMemberService.remove = vi.fn().mockResolvedValue(undefined);

      await controller.delete('org-1', 'm-1', 'actor-user-id');

      expect(mockRemoveMemberService.remove).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        'actor-user-id',
      );
    });

    it('invalidates entire org RBAC cache after removal', async () => {
      mockRemoveMemberService.remove = vi.fn().mockResolvedValue(undefined);

      await controller.delete('org-1', 'm-1', 'actor-user-id');

      expect(mockRBACCacheService.invalidateOrg).toHaveBeenCalledWith('org-1');
    });

    it('returns success message with expected format', async () => {
      mockRemoveMemberService.remove = vi.fn().mockResolvedValue(undefined);

      const result = await controller.delete('org-1', 'm-1', 'actor-user-id');

      expect(result).toEqual({ message: 'Membership deleted successfully' });
    });

    it('propagates errors from RemoveMemberService', async () => {
      mockRemoveMemberService.remove = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(
        controller.delete('org-1', 'm-x', 'actor-user-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
