import { NotFoundException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { RemoveMemberService } from './remove-member.service';
import { PENDING_USER_PREFIX } from '@libs/common';
import { vi } from 'vitest';

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: 'MEMBER' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const realUser = {
  id: 'u-1',
  auth0Id: 'google-oauth2|abc',
  email: 'user@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const pendingUser = {
  id: 'u-1',
  auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
  email: 'invited@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMembershipsService = {
  findById: vi.fn(),
  deleteMembership: vi.fn(),
  findByUser: vi.fn(),
};

const mockUsersService = {
  findById: vi.fn(),
  deleteUser: vi.fn(),
};

const mockIdentityProvider = {
  deleteUser: vi.fn(),
};

const mockActivityLog = {
  logActivity: vi.fn(),
};

const mockLegalAudit = {
  recordEvent: vi.fn(),
};

function buildService(): RemoveMemberService {
  return new RemoveMemberService(
    mockMembershipsService as never,
    mockUsersService as never,
    mockIdentityProvider as never,
    mockActivityLog as never,
    mockLegalAudit as never,
  );
}

describe('RemoveMemberService', () => {
  let service: RemoveMemberService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = buildService();

    // Default happy-path stubs (last membership, real Auth0 user)
    mockMembershipsService.findById.mockResolvedValue(baseMembership);
    mockMembershipsService.deleteMembership.mockResolvedValue(undefined);
    mockMembershipsService.findByUser.mockResolvedValue([]);
    mockUsersService.findById.mockResolvedValue(realUser);
    mockUsersService.deleteUser.mockResolvedValue(undefined);
    mockIdentityProvider.deleteUser.mockResolvedValue(undefined);
  });

  describe('membership not found', () => {
    it('throws NotFoundException when membership does not exist', async () => {
      mockMembershipsService.findById.mockResolvedValue(null);

      await expect(service.remove('m-x', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMembershipsService.deleteMembership).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when membership belongs to a different org', async () => {
      mockMembershipsService.findById.mockResolvedValue({
        ...baseMembership,
        orgId: 'org-other',
      });

      await expect(service.remove('m-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMembershipsService.deleteMembership).not.toHaveBeenCalled();
    });
  });

  describe('user has remaining memberships', () => {
    it('deletes only the membership when user still belongs to other orgs', async () => {
      mockMembershipsService.findByUser.mockResolvedValue([
        { id: 'm-2', orgId: 'org-2' },
      ]);

      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockMembershipsService.deleteMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        'actor-id',
        'user_action',
      );
      expect(mockUsersService.deleteUser).not.toHaveBeenCalled();
      expect(mockIdentityProvider.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('user has no remaining memberships — full cleanup', () => {
    it('deletes membership, Auth0 account, and Prisma user when no memberships remain', async () => {
      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockMembershipsService.deleteMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        'actor-id',
        'user_action',
      );
      expect(mockIdentityProvider.deleteUser).toHaveBeenCalledWith(
        'google-oauth2|abc',
      );
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('skips Auth0 deletion for invited-pending users who never logged in', async () => {
      mockUsersService.findById.mockResolvedValue(pendingUser);

      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockIdentityProvider.deleteUser).not.toHaveBeenCalled();
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('still deletes Prisma user even when Auth0 deletion fails (best-effort)', async () => {
      mockIdentityProvider.deleteUser.mockRejectedValue(
        new Error('Auth0 network error'),
      );

      // Should not throw
      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('does nothing if user record is already gone from Prisma', async () => {
      mockUsersService.findById.mockResolvedValue(null);

      await service.remove('m-1', 'org-1');

      expect(mockIdentityProvider.deleteUser).not.toHaveBeenCalled();
      expect(mockUsersService.deleteUser).not.toHaveBeenCalled();
    });

    it('still deletes Prisma user when Auth0 deletion throws a non-Error value (line 63 branch)', async () => {
      // Covers `err instanceof Error ? err.message : String(err)` when err is not an Error
      mockIdentityProvider.deleteUser.mockRejectedValue('plain-string-error');

      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });
  });
});
