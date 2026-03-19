import { RBACService } from './rbac.service';
import { MembershipsService } from '@libs/memberships';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@libs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';

const mockMembershipsService = {
  findByUserAndOrg: jest.fn(),
} as unknown as MembershipsService;

describe('RBACService', () => {
  let service: RBACService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RBACService(mockMembershipsService);
  });

  describe('getPermissionsForRole', () => {
    it.each([
      ['OWNER' as MembershipRole],
      ['ADMIN' as MembershipRole],
      ['MEMBER' as MembershipRole],
      ['READ_ONLY' as MembershipRole],
    ])('returns a non-empty array for role %s', (role) => {
      const perms = service.getPermissionsForRole(role);
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown role and does not throw', () => {
      const perms = service.getPermissionsForRole('GHOST' as MembershipRole);
      expect(perms).toEqual([]);
    });

    it('OWNER permissions match the static map', () => {
      expect(service.getPermissionsForRole('OWNER')).toEqual(
        ROLE_PERMISSIONS['OWNER'],
      );
    });
  });

  describe('resolveContext', () => {
    const activeMembership = {
      id: 'm-1',
      userId: 'u-1',
      orgId: 'org-1',
      role: 'ADMIN' as MembershipRole,
      status: 'ACTIVE' as MembershipStatus,
    };

    it('returns full context for an active membership', async () => {
      mockMembershipsService.findByUserAndOrg = jest
        .fn()
        .mockResolvedValue(activeMembership);
      const ctx = await service.resolveContext('u-1', 'org-1');
      expect(ctx).toMatchObject({
        userId: 'u-1',
        orgId: 'org-1',
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      expect(ctx?.permissions).toContain(PERMISSIONS.ORG_MANAGE);
    });

    it('returns null when membership does not exist', async () => {
      mockMembershipsService.findByUserAndOrg = jest
        .fn()
        .mockResolvedValue(null);
      expect(await service.resolveContext('u-1', 'org-x')).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('returns true when user has the permission', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(
        await service.hasPermission(
          'u-1',
          'org-1',
          PERMISSIONS.ORG_BILLING_MANAGE,
        ),
      ).toBe(true);
    });

    it('returns false when membership is INACTIVE', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'OWNER',
        status: 'INACTIVE',
      });
      expect(
        await service.hasPermission('u-1', 'org-1', PERMISSIONS.ORG_MANAGE),
      ).toBe(false);
    });

    it('returns false when context is null', async () => {
      mockMembershipsService.findByUserAndOrg = jest
        .fn()
        .mockResolvedValue(null);
      expect(
        await service.hasPermission('u-1', 'org-1', PERMISSIONS.ORG_READ),
      ).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true if at least one permission matches', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'MEMBER',
        status: 'ACTIVE',
      });
      expect(
        await service.hasAnyPermission('u-1', 'org-1', [
          PERMISSIONS.ORG_MANAGE,
          PERMISSIONS.ORG_READ,
        ]),
      ).toBe(true);
    });

    it('returns false when none match', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'READ_ONLY',
        status: 'ACTIVE',
      });
      expect(
        await service.hasAnyPermission('u-1', 'org-1', [
          PERMISSIONS.ORG_MANAGE,
        ]),
      ).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true only when all permissions are present', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'OWNER',
        status: 'ACTIVE',
      });
      expect(
        await service.hasAllPermissions('u-1', 'org-1', [
          PERMISSIONS.ORG_MANAGE,
          PERMISSIONS.ORG_READ,
        ]),
      ).toBe(true);
    });

    it('returns false when one permission is missing', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'MEMBER',
        status: 'ACTIVE',
      });
      expect(
        await service.hasAllPermissions('u-1', 'org-1', [
          PERMISSIONS.ORG_MANAGE,
          PERMISSIONS.ORG_READ,
        ]),
      ).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('returns true when role matches', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'ADMIN',
        status: 'ACTIVE',
      });
      expect(await service.hasRole('u-1', 'org-1', ['OWNER', 'ADMIN'])).toBe(
        true,
      );
    });

    it('returns false when membership is missing', async () => {
      mockMembershipsService.findByUserAndOrg = jest
        .fn()
        .mockResolvedValue(null);
      expect(await service.hasRole('u-1', 'org-1', ['ADMIN'])).toBe(false);
    });

    it('returns false when membership status is INACTIVE', async () => {
      mockMembershipsService.findByUserAndOrg = jest.fn().mockResolvedValue({
        role: 'ADMIN',
        status: 'INACTIVE',
      });
      expect(await service.hasRole('u-1', 'org-1', ['ADMIN'])).toBe(false);
    });
  });
});
