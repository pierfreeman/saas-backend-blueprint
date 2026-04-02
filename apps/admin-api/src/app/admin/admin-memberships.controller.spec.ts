import { vi } from 'vitest';
import { AdminMembershipsController } from './admin-memberships.controller';
import { AdminMembershipsService } from '@libs/admin/memberships';
import {
  AdminChangeRoleDto,
  AdminInviteMemberDto,
  AdminListMembersQueryDto,
} from './dto/admin.dto';
import { MembershipRole } from '@libs/prisma-business';

const mockAdminMembershipsService = {
  listMembers: vi.fn(),
  inviteMember: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
} as unknown as AdminMembershipsService;

const ACTOR_ADMIN_ID = 'admin-user-id';

describe('AdminMembershipsController', () => {
  let controller: AdminMembershipsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminMembershipsController(mockAdminMembershipsService);
  });

  describe('listMembers()', () => {
    it('delegates to service with orgId and pagination defaults', async () => {
      const mockResult = { items: [], total: 0, limit: 20, offset: 0 };
      mockAdminMembershipsService.listMembers = vi
        .fn()
        .mockResolvedValue(mockResult);

      const query: AdminListMembersQueryDto = {} as AdminListMembersQueryDto;
      const result = await controller.listMembers('org-1', query);

      expect(result).toBe(mockResult);
      expect(mockAdminMembershipsService.listMembers).toHaveBeenCalledWith(
        'org-1',
        { limit: 20, offset: 0 },
      );
    });

    it('passes provided limit and offset to the service', async () => {
      mockAdminMembershipsService.listMembers = vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, limit: 10, offset: 5 });

      await controller.listMembers('org-1', {
        limit: 10,
        offset: 5,
      } as AdminListMembersQueryDto);

      expect(mockAdminMembershipsService.listMembers).toHaveBeenCalledWith(
        'org-1',
        { limit: 10, offset: 5 },
      );
    });
  });

  describe('inviteMember()', () => {
    it('delegates to service with orgId, dto fields, and actorAdminId', async () => {
      const mockMembership = { id: 'm-1', orgId: 'org-1' };
      mockAdminMembershipsService.inviteMember = vi
        .fn()
        .mockResolvedValue(mockMembership);

      const dto: AdminInviteMemberDto = {
        email: 'user@example.com',
        role: MembershipRole.MEMBER,
      } as AdminInviteMemberDto;

      const result = await controller.inviteMember(
        'org-1',
        dto,
        ACTOR_ADMIN_ID,
      );

      expect(result).toBe(mockMembership);
      expect(mockAdminMembershipsService.inviteMember).toHaveBeenCalledWith({
        orgId: 'org-1',
        email: 'user@example.com',
        role: MembershipRole.MEMBER,
        actorAdminId: ACTOR_ADMIN_ID,
      });
    });
  });

  describe('changeRole()', () => {
    it('delegates to service with orgId, membershipId, newRole, and actorAdminId', async () => {
      const mockResult = { id: 'm-1', role: MembershipRole.ADMIN };
      mockAdminMembershipsService.changeRole = vi
        .fn()
        .mockResolvedValue(mockResult);

      const dto: AdminChangeRoleDto = {
        newRole: MembershipRole.ADMIN,
      } as AdminChangeRoleDto;

      const result = await controller.changeRole(
        'org-1',
        'm-1',
        dto,
        ACTOR_ADMIN_ID,
      );

      expect(result).toBe(mockResult);
      expect(mockAdminMembershipsService.changeRole).toHaveBeenCalledWith({
        orgId: 'org-1',
        membershipId: 'm-1',
        newRole: MembershipRole.ADMIN,
        actorAdminId: ACTOR_ADMIN_ID,
      });
    });
  });

  describe('removeMember()', () => {
    it('delegates to service with orgId, membershipId, and actorAdminId', async () => {
      mockAdminMembershipsService.removeMember = vi
        .fn()
        .mockResolvedValue(undefined);

      await controller.removeMember('org-1', 'm-1', ACTOR_ADMIN_ID);

      expect(mockAdminMembershipsService.removeMember).toHaveBeenCalledWith({
        orgId: 'org-1',
        membershipId: 'm-1',
        actorAdminId: ACTOR_ADMIN_ID,
      });
    });

    it('returns void on success', async () => {
      mockAdminMembershipsService.removeMember = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await controller.removeMember(
        'org-1',
        'm-1',
        ACTOR_ADMIN_ID,
      );
      expect(result).toBeUndefined();
    });
  });
});
