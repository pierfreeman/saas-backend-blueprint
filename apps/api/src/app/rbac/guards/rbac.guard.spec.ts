import { RBACGuard } from './rbac.guard';
import { Reflector } from '@nestjs/core';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PERMISSIONS } from '@libs/common';

const mockReflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
const mockPermissionResolver = {
  resolvePermissions: jest.fn(),
} as unknown as PermissionResolverService;

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RBACGuard', () => {
  let guard: RBACGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RBACGuard(mockReflector, mockPermissionResolver);
  });

  it('passes when no RBAC metadata is set on the route', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);
    const ctx = makeContext({});
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user context is missing', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({ permissions: [PERMISSIONS.ORG_READ], mode: 'ANY' })
      .mockReturnValueOnce(undefined);
    const ctx = makeContext({
      user: undefined,
      orgId: 'org-1',
      membership: { status: 'ACTIVE', role: 'MEMBER' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when orgId is missing', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({ permissions: [PERMISSIONS.ORG_READ], mode: 'ANY' })
      .mockReturnValueOnce(undefined);
    const ctx = makeContext({
      user: { dbUserId: 'u-1' },
      orgId: undefined,
      membership: { status: 'ACTIVE', role: 'MEMBER' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('grants access when user has the required permission', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({ permissions: [PERMISSIONS.ORG_READ], mode: 'ANY' })
      .mockReturnValueOnce(undefined);
    mockPermissionResolver.resolvePermissions = jest
      .fn()
      .mockResolvedValue([PERMISSIONS.ORG_READ, PERMISSIONS.ORG_MANAGE]);

    const request: Record<string, unknown> = {
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'ADMIN', status: 'ACTIVE' },
      tenantContext: { tenantId: 'org-1', timestamp: new Date() },
    };
    expect(await guard.canActivate(makeContext(request))).toBe(true);
  });

  it('denies access when required permission is missing', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({
        permissions: [PERMISSIONS.ORG_BILLING_MANAGE],
        mode: 'ANY',
      })
      .mockReturnValueOnce(undefined);
    mockPermissionResolver.resolvePermissions = jest
      .fn()
      .mockResolvedValue([PERMISSIONS.ORG_READ]);

    const ctx = makeContext({
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'MEMBER', status: 'ACTIVE' },
      tenantContext: { tenantId: 'org-1', timestamp: new Date() },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('grants access on role match (fast path, no Redis lookup)', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(undefined) // no permissions metadata
      .mockReturnValueOnce(['OWNER', 'ADMIN']); // requiredRoles

    const ctx = makeContext({
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'ADMIN', status: 'ACTIVE' },
    });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(mockPermissionResolver.resolvePermissions).not.toHaveBeenCalled();
  });

  it('denies access when role does not match', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(['OWNER']);

    const ctx = makeContext({
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'MEMBER', status: 'ACTIVE' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('mode ALL requires every permission to be present', async () => {
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({
        permissions: [PERMISSIONS.ORG_READ, PERMISSIONS.ORG_MANAGE],
        mode: 'ALL',
      })
      .mockReturnValueOnce(undefined);
    mockPermissionResolver.resolvePermissions = jest
      .fn()
      .mockResolvedValue([PERMISSIONS.ORG_READ]); // ORG_MANAGE missing

    const ctx = makeContext({
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'MEMBER', status: 'ACTIVE' },
      tenantContext: { tenantId: 'org-1', timestamp: new Date() },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('enriches tenantContext.permissions after successful check', async () => {
    const perms = [PERMISSIONS.ORG_READ, PERMISSIONS.ORG_MANAGE];
    mockReflector.getAllAndOverride = jest
      .fn()
      .mockReturnValueOnce({ permissions: [PERMISSIONS.ORG_READ], mode: 'ANY' })
      .mockReturnValueOnce(undefined);
    mockPermissionResolver.resolvePermissions = jest
      .fn()
      .mockResolvedValue(perms);

    const tenantContext = { tenantId: 'org-1', timestamp: new Date() };
    const request: Record<string, unknown> = {
      user: { dbUserId: 'u-1' },
      orgId: 'org-1',
      membership: { id: 'm-1', role: 'ADMIN', status: 'ACTIVE' },
      tenantContext,
    };
    await guard.canActivate(makeContext(request));
    expect((request.tenantContext as any).permissions).toEqual(perms);
    expect((request.tenantContext as any).role).toBe('ADMIN');
  });
});
