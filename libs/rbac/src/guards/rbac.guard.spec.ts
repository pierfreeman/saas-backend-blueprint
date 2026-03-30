import { vi } from 'vitest';
import { RBACGuard } from './rbac.guard';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { PERMISSIONS } from '@libs/common';
import { RequestWithOrgContext } from './org-context.guard';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockReflector = {
  getAllAndOverride: vi.fn(),
} as unknown as Reflector;

const mockPermissionResolver = {
  resolvePermissions: vi.fn(),
} as unknown as PermissionResolverService;

const USER_ID = 'user-uuid-1';
const ORG_ID = 'org-uuid-1';

function makeContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  const request: Partial<RequestWithOrgContext> = {
    user: { sub: 'auth0|123', email: 'test@example.com', dbUserId: USER_ID },
    orgId: ORG_ID,
    membership: {
      id: 'membership-1',
      role: MembershipRole.ADMIN,
      status: MembershipStatus.ACTIVE,
    },
    tenantContext: undefined,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: vi.fn(),
      getNext: vi.fn(),
    }),
    getHandler: vi.fn(),
    getClass: vi.fn(),
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: vi.fn(),
    ...overrides,
  } as unknown as ExecutionContext;
}

describe('RBACGuard', () => {
  let guard: RBACGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new RBACGuard(mockReflector, mockPermissionResolver);
  });

  // ── No Decorators ──────────────────────────────────────────────────────────

  describe('no decorators', () => {
    it('passes through when no @RequireRole or @RequirePermissions decorator is present', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(undefined);
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });
  });

  // ── @RequireRole Decorator ─────────────────────────────────────────────────

  describe('@RequireRole', () => {
    it('grants access when user role matches required role', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.ADMIN];
        return undefined;
      });
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockPermissionResolver.resolvePermissions).not.toHaveBeenCalled();
    });

    it('grants access when user has one of multiple required roles', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY)
          return [MembershipRole.OWNER, MembershipRole.ADMIN];
        return undefined;
      });
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('denies access when user role does not match', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.OWNER];
        return undefined;
      });
      const ctx = makeContext();

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'You do not have the required role',
      );
    });
  });

  // ── @RequirePermissions Decorator ──────────────────────────────────────────

  describe('@RequirePermissions', () => {
    it('grants access when user has the required permission', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [PERMISSIONS.ORG_MANAGE],
            mode: 'ANY',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue([PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ]);
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockPermissionResolver.resolvePermissions).toHaveBeenCalledWith(
        USER_ID,
        ORG_ID,
      );
    });

    it('denies access when user does not have the required permission', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [PERMISSIONS.ORG_BILLING_MANAGE],
            mode: 'ANY',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue([PERMISSIONS.ORG_READ]);
      const ctx = makeContext();

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'You do not have permission to perform this action',
      );
    });

    it('grants access with mode=ALL when user has all required permissions', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ],
            mode: 'ALL',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue([
          PERMISSIONS.ORG_MANAGE,
          PERMISSIONS.ORG_READ,
          PERMISSIONS.ANALYTICS_VIEW,
        ]);
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('denies access with mode=ALL when user is missing one permission', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [
              PERMISSIONS.ORG_MANAGE,
              PERMISSIONS.ORG_BILLING_MANAGE,
            ],
            mode: 'ALL',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue([PERMISSIONS.ORG_MANAGE]);
      const ctx = makeContext();

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('injects permissions and role into request', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [PERMISSIONS.ORG_MANAGE],
            mode: 'ANY',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      const permissions = [PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ];
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue(permissions);
      const ctx = makeContext();
      const request = ctx.switchToHttp().getRequest() as RequestWithOrgContext;

      await guard.canActivate(ctx);

      expect(request.rbacPermissions).toEqual(permissions);
      expect(request.rbacRole).toBe(MembershipRole.ADMIN);
    });

    it('syncs permissions and role into tenantContext if present', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY)
          return {
            permissions: [PERMISSIONS.ORG_READ],
            mode: 'ANY',
          };
        if (key === REQUIRE_ROLE_KEY) return undefined;
        return undefined;
      });
      const permissions = [PERMISSIONS.ORG_READ];
      mockPermissionResolver.resolvePermissions = vi
        .fn()
        .mockResolvedValue(permissions);

      const request: Partial<RequestWithOrgContext> = {
        user: {
          sub: 'auth0|123',
          email: 'test@example.com',
          dbUserId: USER_ID,
        },
        orgId: ORG_ID,
        membership: {
          id: 'membership-1',
          role: MembershipRole.MEMBER,
          status: MembershipStatus.ACTIVE,
        },
        tenantContext: {
          tenantId: ORG_ID,
          userId: USER_ID,
          role: MembershipRole.MEMBER,
          permissions: undefined,
          timestamp: new Date(),
        },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);

      expect(request.tenantContext?.permissions).toEqual(permissions);
      expect(request.tenantContext?.role).toBe(MembershipRole.MEMBER);
    });
  });

  // ── Membership Status ──────────────────────────────────────────────────────

  describe('membership status', () => {
    it('throws ForbiddenException when membership status is INACTIVE', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.ADMIN];
        return undefined;
      });

      const request: Partial<RequestWithOrgContext> = {
        user: {
          sub: 'auth0|123',
          email: 'test@example.com',
          dbUserId: USER_ID,
        },
        orgId: ORG_ID,
        membership: {
          id: 'membership-1',
          role: MembershipRole.ADMIN,
          status: MembershipStatus.INACTIVE,
        },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Membership is not active',
      );
    });
  });

  // ── Missing Context ────────────────────────────────────────────────────────

  describe('missing context', () => {
    it('throws ForbiddenException when userId is missing', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.ADMIN];
        return undefined;
      });

      const request: Partial<RequestWithOrgContext> = {
        user: {
          sub: 'auth0|123',
          email: 'test@example.com',
          dbUserId: undefined,
        },
        orgId: ORG_ID,
        membership: {
          id: 'membership-1',
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'User context not found',
      );
    });

    it('throws ForbiddenException when orgId is missing', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.ADMIN];
        return undefined;
      });

      const request: Partial<RequestWithOrgContext> = {
        user: {
          sub: 'auth0|123',
          email: 'test@example.com',
          dbUserId: USER_ID,
        },
        orgId: undefined,
        membership: {
          id: 'membership-1',
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Organization context not found',
      );
    });

    it('throws ForbiddenException when membership is missing', async () => {
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY) return [MembershipRole.ADMIN];
        return undefined;
      });

      const request: Partial<RequestWithOrgContext> = {
        user: {
          sub: 'auth0|123',
          email: 'test@example.com',
          dbUserId: USER_ID,
        },
        orgId: ORG_ID,
        membership: undefined,
      };

      const ctx = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
        getHandler: vi.fn(),
        getClass: vi.fn(),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Membership not found',
      );
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns true when role matches and no permission check needed', async () => {
      // This tests the path where role matches, there's no permission metadata,
      // so it should return true (line 103)
      mockReflector.getAllAndOverride = vi.fn((key) => {
        if (key === PERMISSIONS_KEY) return undefined;
        if (key === REQUIRE_ROLE_KEY)
          return [MembershipRole.ADMIN, MembershipRole.OWNER];
        return undefined;
      });
      const ctx = makeContext();

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });
  });
});
