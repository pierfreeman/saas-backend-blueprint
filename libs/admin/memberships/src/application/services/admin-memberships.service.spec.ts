import { Test, TestingModule } from '@nestjs/testing';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { AdminMembershipsService } from './admin-memberships.service';
import { AdminMembershipsRepository } from '../../infrastructure/repositories/admin-memberships.repository';
import { MembershipsService } from '@libs/memberships';
import { InviteMemberService } from '@libs/memberships';
import { RemoveMemberService } from '@libs/memberships';

const mockMembership = {
  id: 'mem-1',
  orgId: 'org-1',
  userId: 'user-1',
  role: MembershipRole.MEMBER,
  status: MembershipStatus.ACTIVE,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-06-01'),
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    pictureUrl: null,
    auth0Id: 'auth0|abc',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe('AdminMembershipsService', () => {
  let service: AdminMembershipsService;

  const mockRepository = {
    findByOrgPaginated: vi.fn(),
  };

  const mockMembershipsService = {
    updateMembership: vi.fn(),
  };

  const mockInviteMemberService = {
    invite: vi.fn(),
  };

  const mockRemoveMemberService = {
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminMembershipsService,
        { provide: AdminMembershipsRepository, useValue: mockRepository },
        { provide: MembershipsService, useValue: mockMembershipsService },
        { provide: InviteMemberService, useValue: mockInviteMemberService },
        { provide: RemoveMemberService, useValue: mockRemoveMemberService },
      ],
    }).compile();

    service = module.get(AdminMembershipsService);
  });

  describe('listMembers', () => {
    it('returns paginated members with user data', async () => {
      mockRepository.findByOrgPaginated.mockResolvedValue({
        items: [mockMembership],
        total: 1,
      });

      const result = await service.listMembers('org-1');

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('mem-1');
      expect(result.items[0].user.email).toBe('alice@example.com');
    });

    it('uses default limit 50 when not provided', async () => {
      mockRepository.findByOrgPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.listMembers('org-1');

      expect(mockRepository.findByOrgPaginated).toHaveBeenCalledWith(
        'org-1',
        { limit: 50, offset: 0 },
        {},
      );
    });

    it('caps limit at 200', async () => {
      mockRepository.findByOrgPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.listMembers('org-1', { limit: 9999 });

      expect(mockRepository.findByOrgPaginated).toHaveBeenCalledWith(
        'org-1',
        { limit: 200, offset: 0 },
        {},
      );
    });

    it('passes through pagination offset and status filter', async () => {
      mockRepository.findByOrgPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });

      await service.listMembers(
        'org-1',
        { limit: 10, offset: 20 },
        { status: MembershipStatus.PENDING },
      );

      expect(mockRepository.findByOrgPaginated).toHaveBeenCalledWith(
        'org-1',
        { limit: 10, offset: 20 },
        { status: MembershipStatus.PENDING },
      );
    });

    it('defaults missing user profile fields to null', async () => {
      mockRepository.findByOrgPaginated.mockResolvedValue({
        items: [
          {
            ...mockMembership,
            user: {
              ...mockMembership.user,
              firstName: null,
              lastName: null,
              pictureUrl: null,
            },
          },
        ],
        total: 1,
      });

      const result = await service.listMembers('org-1');

      expect(result.items[0].user.firstName).toBeNull();
      expect(result.items[0].user.lastName).toBeNull();
      expect(result.items[0].user.pictureUrl).toBeNull();
    });
  });

  describe('changeRole', () => {
    it('delegates to MembershipsService.updateMembership', async () => {
      mockMembershipsService.updateMembership.mockResolvedValue({
        ...mockMembership,
        role: MembershipRole.ADMIN,
      });

      const result = await service.changeRole({
        membershipId: 'mem-1',
        orgId: 'org-1',
        newRole: MembershipRole.ADMIN,
        actorAdminId: 'admin-user-1',
      });

      expect(mockMembershipsService.updateMembership).toHaveBeenCalledWith(
        'mem-1',
        'org-1',
        { role: MembershipRole.ADMIN },
        'admin-user-1',
        'admin_action',
      );
      expect(result.role).toBe(MembershipRole.ADMIN);
    });
  });

  describe('inviteMember', () => {
    it('delegates to InviteMemberService.invite', async () => {
      mockInviteMemberService.invite.mockResolvedValue({
        message: 'Invitation sent',
      });

      const result = await service.inviteMember({
        orgId: 'org-1',
        email: 'bob@example.com',
        role: MembershipRole.MEMBER,
        actorAdminId: 'admin-user-1',
      });

      expect(mockInviteMemberService.invite).toHaveBeenCalledWith(
        'bob@example.com',
        MembershipRole.MEMBER,
        'org-1',
        'admin-user-1',
        'admin_action',
      );
      expect(result.message).toBe('Invitation sent');
    });
  });

  describe('removeMember', () => {
    it('delegates to RemoveMemberService.remove', async () => {
      mockRemoveMemberService.remove.mockResolvedValue(undefined);

      await service.removeMember({
        membershipId: 'mem-1',
        orgId: 'org-1',
        actorAdminId: 'admin-user-1',
      });

      expect(mockRemoveMemberService.remove).toHaveBeenCalledWith(
        'mem-1',
        'org-1',
        'admin-user-1',
        'admin_action',
      );
    });
  });
});
