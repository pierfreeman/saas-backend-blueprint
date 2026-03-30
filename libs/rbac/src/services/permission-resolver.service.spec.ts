import { vi } from 'vitest';
import { PermissionResolverService } from './permission-resolver.service';
import { RBACService, RBACContextData } from './rbac.service';
import { RBACCacheService } from './rbac-cache.service';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { PERMISSIONS } from '@libs/common';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockRbacService = {
  resolveContext: vi.fn(),
  getPermissionsForRole: vi.fn(),
} as unknown as RBACService;

const mockRbacCache = {
  get: vi.fn(),
  set: vi.fn(),
  invalidate: vi.fn(),
} as unknown as RBACCacheService;

const USER_ID = 'user-uuid-1';
const ORG_ID = 'org-uuid-1';

function makeContext(
  overrides: Partial<RBACContextData> = {},
): RBACContextData {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    role: MembershipRole.ADMIN,
    status: MembershipStatus.ACTIVE,
    permissions: [PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ],
    ...overrides,
  };
}

describe('PermissionResolverService', () => {
  let service: PermissionResolverService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PermissionResolverService(mockRbacService, mockRbacCache);
  });

  // ── resolvePermissions ─────────────────────────────────────────────────────

  describe('resolvePermissions', () => {
    it('cache HIT: returns cached permissions without calling rbacService', async () => {
      const cachedContext = makeContext();
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.resolvePermissions(USER_ID, ORG_ID);

      expect(mockRbacCache.get).toHaveBeenCalledWith(USER_ID, ORG_ID);
      expect(mockRbacService.resolveContext).not.toHaveBeenCalled();
      expect(result).toEqual(cachedContext.permissions);
    });

    it('cache MISS: calls rbacService, populates cache, and returns permissions', async () => {
      const context = makeContext();
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(context);

      const result = await service.resolvePermissions(USER_ID, ORG_ID);

      expect(mockRbacCache.get).toHaveBeenCalledWith(USER_ID, ORG_ID);
      expect(mockRbacService.resolveContext).toHaveBeenCalledWith(
        USER_ID,
        ORG_ID,
      );
      expect(mockRbacCache.set).toHaveBeenCalledWith(context);
      expect(result).toEqual(context.permissions);
    });

    it('returns empty array when rbacService returns null', async () => {
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(null);

      const result = await service.resolvePermissions(USER_ID, ORG_ID);

      expect(result).toEqual([]);
      expect(mockRbacCache.set).not.toHaveBeenCalled();
    });
  });

  // ── hasPermission ──────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('returns true when user has the permission', async () => {
      const cachedContext = makeContext({
        permissions: [PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_MANAGE,
      );

      expect(result).toBe(true);
    });

    it('returns false when user does not have the permission', async () => {
      const cachedContext = makeContext({
        permissions: [PERMISSIONS.ORG_READ],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasPermission(
        USER_ID,
        ORG_ID,
        PERMISSIONS.ORG_MANAGE,
      );

      expect(result).toBe(false);
    });

    it('returns false when permissions are empty', async () => {
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(null);

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
      const cachedContext = makeContext({
        permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.ANALYTICS_VIEW],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when user has none of the required permissions', async () => {
      const cachedContext = makeContext({
        permissions: [PERMISSIONS.ORG_READ],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_BILLING_MANAGE,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when permissions are empty', async () => {
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(null);

      const result = await service.hasAnyPermission(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });
  });

  // ── hasAllPermissions ──────────────────────────────────────────────────────

  describe('hasAllPermissions', () => {
    it('returns true when user has all required permissions', async () => {
      const cachedContext = makeContext({
        permissions: [
          PERMISSIONS.ORG_MANAGE,
          PERMISSIONS.ORG_READ,
          PERMISSIONS.ORG_BILLING_MANAGE,
        ],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(true);
    });

    it('returns false when user is missing at least one permission', async () => {
      const cachedContext = makeContext({
        permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.ANALYTICS_VIEW],
      });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_MANAGE,
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });

    it('returns false when permissions are empty', async () => {
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(null);

      const result = await service.hasAllPermissions(USER_ID, ORG_ID, [
        PERMISSIONS.ORG_READ,
      ]);

      expect(result).toBe(false);
    });
  });

  // ── getUserRole ────────────────────────────────────────────────────────────

  describe('getUserRole', () => {
    it('returns cached role on cache HIT', async () => {
      const cachedContext = makeContext({ role: MembershipRole.OWNER });
      mockRbacCache.get = vi.fn().mockResolvedValue(cachedContext);

      const result = await service.getUserRole(USER_ID, ORG_ID);

      expect(mockRbacCache.get).toHaveBeenCalledWith(USER_ID, ORG_ID);
      expect(mockRbacService.resolveContext).not.toHaveBeenCalled();
      expect(result).toBe(MembershipRole.OWNER);
    });

    it('fetches role from rbacService and caches on cache MISS', async () => {
      const context = makeContext({ role: MembershipRole.ADMIN });
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(context);

      const result = await service.getUserRole(USER_ID, ORG_ID);

      expect(mockRbacCache.get).toHaveBeenCalledWith(USER_ID, ORG_ID);
      expect(mockRbacService.resolveContext).toHaveBeenCalledWith(
        USER_ID,
        ORG_ID,
      );
      expect(mockRbacCache.set).toHaveBeenCalledWith(context);
      expect(result).toBe(MembershipRole.ADMIN);
    });

    it('returns null when no membership exists', async () => {
      mockRbacCache.get = vi.fn().mockResolvedValue(null);
      mockRbacService.resolveContext = vi.fn().mockResolvedValue(null);

      const result = await service.getUserRole(USER_ID, ORG_ID);

      expect(result).toBeNull();
      expect(mockRbacCache.set).not.toHaveBeenCalled();
    });
  });
});
