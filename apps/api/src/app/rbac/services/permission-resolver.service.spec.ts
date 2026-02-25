import { PermissionResolverService } from './permission-resolver.service';
import { RBACService, RBACContextData } from './rbac.service';
import { RBACCacheService } from './rbac-cache.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PERMISSIONS } from '@libs/common';

const mockRbacService = {
  resolveContext: jest.fn(),
} as unknown as RBACService;

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
} as unknown as RBACCacheService;

const roleContext: RBACContextData = {
  userId: 'u-1',
  orgId: 'org-1',
  role: 'ADMIN' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.ORG_MANAGE],
};

describe('PermissionResolverService', () => {
  let service: PermissionResolverService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PermissionResolverService(mockRbacService, mockCacheService);
  });

  describe('resolvePermissions', () => {
    it('returns cached permissions on cache HIT', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      const perms = await service.resolvePermissions('u-1', 'org-1');
      expect(perms).toEqual(roleContext.permissions);
      expect(mockRbacService.resolveContext).not.toHaveBeenCalled();
    });

    it('fetches from DB, caches and returns on cache MISS', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = jest.fn().mockResolvedValue(roleContext);
      mockCacheService.set = jest.fn().mockResolvedValue(undefined);

      const perms = await service.resolvePermissions('u-1', 'org-1');

      expect(perms).toEqual(roleContext.permissions);
      expect(mockRbacService.resolveContext).toHaveBeenCalledWith(
        'u-1',
        'org-1',
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(roleContext);
    });

    it('returns [] when context is null (no membership)', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = jest.fn().mockResolvedValue(null);
      const perms = await service.resolvePermissions('u-1', 'org-x');
      expect(perms).toEqual([]);
    });
  });

  describe('hasPermission', () => {
    it('returns true when permission is present', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasPermission('u-1', 'org-1', PERMISSIONS.ORG_READ),
      ).toBe(true);
    });

    it('returns false when permission is absent', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasPermission(
          'u-1',
          'org-1',
          PERMISSIONS.ORG_BILLING_MANAGE,
        ),
      ).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true when at least one permission matches', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasAnyPermission('u-1', 'org-1', [
          PERMISSIONS.ORG_BILLING_MANAGE,
          PERMISSIONS.ORG_READ,
        ]),
      ).toBe(true);
    });

    it('returns false when none match', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasAnyPermission('u-1', 'org-1', [
          PERMISSIONS.ORG_BILLING_MANAGE,
          PERMISSIONS.ANALYTICS_EXPORT,
        ]),
      ).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when all permissions are present', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasAllPermissions('u-1', 'org-1', [
          PERMISSIONS.ORG_READ,
          PERMISSIONS.ORG_MANAGE,
        ]),
      ).toBe(true);
    });

    it('returns false when one permission is missing', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(
        await service.hasAllPermissions('u-1', 'org-1', [
          PERMISSIONS.ORG_READ,
          PERMISSIONS.ORG_BILLING_MANAGE,
        ]),
      ).toBe(false);
    });
  });

  describe('getUserRole', () => {
    it('returns role from cache when present', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(roleContext);
      expect(await service.getUserRole('u-1', 'org-1')).toBe('ADMIN');
    });

    it('resolves from DB on cache miss and returns role', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = jest.fn().mockResolvedValue(roleContext);
      mockCacheService.set = jest.fn().mockResolvedValue(undefined);
      expect(await service.getUserRole('u-1', 'org-1')).toBe('ADMIN');
    });

    it('returns null when context is null', async () => {
      mockCacheService.get = jest.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = jest.fn().mockResolvedValue(null);
      expect(await service.getUserRole('u-1', 'org-x')).toBeNull();
    });
  });
});
