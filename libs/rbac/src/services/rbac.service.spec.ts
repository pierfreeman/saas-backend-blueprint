import { vi } from 'vitest';
import { RBACService } from './rbac.service';
import { MembershipsService } from '@libs/memberships';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { PERMISSIONS } from '@libs/common';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockMembershipsService = {
  findByUserAndOrg: vi.fn(),
} as unknown as MembershipsService;

const USER_ID = 'user-uuid-1';
const ORG_ID = 'org-uuid-1';

describe('RBACService', () => {
  let service: RBACService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RBACService(mockMembershipsService);
  });

  // ── getPermissionsForRole ──────────────────────────────────────────────────

  describe('getPermissionsForRole', () => {
    it('returns all permissions for OWNER role', () => {
      const permissions = service.getPermissionsForRole(MembershipRole.OWNER);
      expect(permissions).toContain(PERMISSIONS.ORG_MANAGE);
      expect(permissions).toContain(PERMISSIONS.ORG_BILLING_MANAGE);
      expect(permissions).toContain(PERMISSIONS.ORG_MEMBERS_INVITE);
      expect(permissions).toContain(PERMISSIONS.ORG_MEMBERS_REMOVE);
      expect(permissions).toContain(PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE);
      expect(permissions).toContain(PERMISSIONS.ORG_READ);
      expect(permissions).toContain(PERMISSIONS.ANALYTICS_VIEW);
      expect(permissions).toContain(PERMISSIONS.ANALYTICS_EXPORT);
    });

    it('returns correct permissions for ADMIN role', () => {
      const permissions = service.getPermissionsForRole(MembershipRole.ADMIN);
      expect(permissions).toContain(PERMISSIONS.ORG_MANAGE);
      expect(permissions).toContain(PERMISSIONS.ORG_MEMBERS_INVITE);
      expect(permissions).not.toContain(PERMISSIONS.ORG_BILLING_MANAGE);
      expect(permissions).not.toContain(PERMISSIONS.ANALYTICS_EXPORT);
    });

    it('returns correct permissions for MEMBER role', () => {
      const permissions = service.getPermissionsForRole(MembershipRole.MEMBER);
      expect(permissions).toContain(PERMISSIONS.ORG_READ);
      expect(permissions).toContain(PERMISSIONS.ANALYTICS_VIEW);
      expect(permissions).not.toContain(PERMISSIONS.ORG_MANAGE);
      expect(permissions).not.toContain(PERMISSIONS.ORG_MEMBERS_INVITE);
    });

    it('returns only read permission for READ_ONLY role', () => {
      const permissions = service.getPermissionsForRole(
        MembershipRole.READ_ONLY,
      );
      expect(permissions).toEqual([PERMISSIONS.ORG_READ]);
    });

    it('returns empty array for unknown role and logs warning', () => {
      const permissions = service.getPermissionsForRole(
        'UNKNOWN' as MembershipRole,
      );
      expect(permissions).toEqual([]);
    });
  });

  // ── resolveContext ─────────────────────────────────────────────────────────

  describe('resolveContext', () => {
    it('returns full context when membership is ACTIVE', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.resolveContext(USER_ID, ORG_ID);

      expect(mockMembershipsService.findByUserAndOrg).toHaveBeenCalledWith(
        USER_ID,
        ORG_ID,
      );
      expect(result).toEqual({
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        permissions: expect.arrayContaining([PERMISSIONS.ORG_MANAGE]),
      });
    });

    it('returns context with INACTIVE status when membership is INACTIVE', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.MEMBER,
        status: MembershipStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.resolveContext(USER_ID, ORG_ID);

      expect(result).not.toBeNull();
      expect(result?.status).toBe(MembershipStatus.INACTIVE);
      expect(result?.role).toBe(MembershipRole.MEMBER);
    });

    it('returns null when membership is not found', async () => {
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.resolveContext(USER_ID, ORG_ID);

      expect(result).toBeNull();
    });
  });

  // ── hasPermission ──────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('returns true when user has the required permission and status is ACTIVE', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_MANAGE,
      );

      expect(result).toBe(true);
    });

    it('returns false when user does not have the required permission', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.READ_ONLY,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_MANAGE,
      );

      expect(result).toBe(false);
    });

    it('returns false when membership is INACTIVE regardless of permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.OWNER,
        status: MembershipStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_MANAGE,
      );

      expect(result).toBe(false);
    });

    it('returns false when membership is not found', async () => {
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_READ,
      );

      expect(result).toBe(false);
    });
  });

  // ── hasAnyPermission ───────────────────────────────────────────────────────

  describe('hasAnyPermission', () => {
    it('returns true when user has at least one of the required permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when user has none of the required permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.READ_ONLY,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_BILLING_MANAGE,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is INACTIVE regardless of permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.OWNER,
        status: MembershipStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
        PERMISSIONS.ORG_MANAGE,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is not found', async () => {
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });
  });

  // ── hasAllPermissions ──────────────────────────────────────────────────────

  describe('hasAllPermissions', () => {
    it('returns true when user has all required permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.OWNER,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_READ,
        PERMISSIONS.ORG_BILLING_MANAGE,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when user is missing at least one permission', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_BILLING_MANAGE, // ADMIN doesn't have this
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is INACTIVE regardless of permissions', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.OWNER,
        status: MembershipStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is not found', async () => {
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });
  });

  // ── hasRole ────────────────────────────────────────────────────────────────

  describe('hasRole', () => {
    it('returns true when user has one of the required roles and status is ACTIVE', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasRole(USER_ID, ORG_ID, [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when user does not have any of the required roles', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasRole(USER_ID, ORG_ID, [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is INACTIVE', async () => {
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: MembershipRole.OWNER,
        status: MembershipStatus.INACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockMembershipsService.findByUserAndOrg = vi
        .fn()
        .mockResolvedValue(membership);

      const result = await service.hasRole(USER_ID, ORG_ID, [
        MembershipRole.OWNER,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when membership is not found', async () => {
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);

      const result = await service.hasRole(USER_ID, ORG_ID, [
        MembershipRole.MEMBER,
      ]);

      expect(result).toBe(false);
    });
  });
});
