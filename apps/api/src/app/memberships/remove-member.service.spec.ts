import { NotFoundException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { RemoveMemberService } from './remove-member.service';
import { PENDING_AUTH0_ID_PREFIX } from '../auth/auth.service';
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
  auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
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

const mockAuth0ManagementService = {
  deleteUser: vi.fn(),
};

function buildService(): RemoveMemberService {
  return new RemoveMemberService(
    mockMembershipsService as never,
    mockUsersService as never,
    mockAuth0ManagementService as never,
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
    mockAuth0ManagementService.deleteUser.mockResolvedValue(undefined);
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
      );
      expect(mockUsersService.deleteUser).not.toHaveBeenCalled();
      expect(mockAuth0ManagementService.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('user has no remaining memberships — full cleanup', () => {
    it('deletes membership, Auth0 account, and Prisma user when no memberships remain', async () => {
      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockMembershipsService.deleteMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        'actor-id',
      );
      expect(mockAuth0ManagementService.deleteUser).toHaveBeenCalledWith(
        'google-oauth2|abc',
      );
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('skips Auth0 deletion for invited-pending users who never logged in', async () => {
      mockUsersService.findById.mockResolvedValue(pendingUser);

      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockAuth0ManagementService.deleteUser).not.toHaveBeenCalled();
      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('still deletes Prisma user even when Auth0 deletion fails (best-effort)', async () => {
      mockAuth0ManagementService.deleteUser.mockRejectedValue(
        new Error('Auth0 network error'),
      );

      // Should not throw
      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });

    it('does nothing if user record is already gone from Prisma', async () => {
      mockUsersService.findById.mockResolvedValue(null);

      await service.remove('m-1', 'org-1');

      expect(mockAuth0ManagementService.deleteUser).not.toHaveBeenCalled();
      expect(mockUsersService.deleteUser).not.toHaveBeenCalled();
    });

    it('still deletes Prisma user when Auth0 deletion throws a non-Error value (line 63 branch)', async () => {
      // Covers `err instanceof Error ? err.message : String(err)` when err is not an Error
      mockAuth0ManagementService.deleteUser.mockRejectedValue(
        'plain-string-error',
      );

      await service.remove('m-1', 'org-1', 'actor-id');

      expect(mockUsersService.deleteUser).toHaveBeenCalledWith('u-1');
    });
  });
});
