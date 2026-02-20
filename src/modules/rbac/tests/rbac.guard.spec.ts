import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RBACGuard } from '../guards/rbac.guard';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions.constants';

describe('RBACGuard', () => {
  let guard: RBACGuard;
  let permissionResolver: PermissionResolverService;
  let reflector: Reflector;

  const mockPermissionResolver = {
    resolvePermissions: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RBACGuard,
        Reflector,
        {
          provide: PermissionResolverService,
          useValue: mockPermissionResolver,
        },
      ],
    }).compile();

    guard = module.get<RBACGuard>(RBACGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  const createMockContext = (request: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  describe('canActivate', () => {
    it('should allow if no RBAC metadata', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
      };

      const context = createMockContext(mockRequest);
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw if no user context', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce({
        permissions: [PERMISSIONS.TEAM_CREATE],
        mode: 'ANY',
      });

      const mockRequest = {
        user: null,
        orgId: 'org-1',
      };

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow('User context not found');
    });

    it('should throw if no org context', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce({
        permissions: [PERMISSIONS.TEAM_CREATE],
        mode: 'ANY',
      });

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: null,
      };

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow('Organization context not found');
    });

    it('should allow if user has required role', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce([MembershipRole.ADMIN]);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
        membership: {
          id: 'membership-1',
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      };

      const context = createMockContext(mockRequest);
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow if user has required permission (ANY mode)', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce({
          permissions: [PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_DELETE],
          mode: 'ANY',
        })
        .mockReturnValueOnce(undefined);

      mockPermissionResolver.resolvePermissions.mockResolvedValue([
        PERMISSIONS.TEAM_CREATE,
        PERMISSIONS.TEAM_READ,
      ]);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
        membership: {
          id: 'membership-1',
          role: MembershipRole.MEMBER,
          status: MembershipStatus.ACTIVE,
        },
      };

      const context = createMockContext(mockRequest);
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should allow if user has all required permissions (ALL mode)', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce({
          permissions: [PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_READ],
          mode: 'ALL',
        })
        .mockReturnValueOnce(undefined);

      mockPermissionResolver.resolvePermissions.mockResolvedValue([
        PERMISSIONS.TEAM_CREATE,
        PERMISSIONS.TEAM_READ,
        PERMISSIONS.TEAM_UPDATE,
      ]);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
        membership: {
          id: 'membership-1',
          role: MembershipRole.ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      };

      const context = createMockContext(mockRequest);
      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should deny if user missing permissions', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce({
          permissions: [PERMISSIONS.TEAM_DELETE],
          mode: 'ANY',
        })
        .mockReturnValueOnce(undefined);

      mockPermissionResolver.resolvePermissions.mockResolvedValue([
        PERMISSIONS.TEAM_READ,
        PERMISSIONS.PLAYER_READ,
      ]);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
        membership: {
          id: 'membership-1',
          role: MembershipRole.READ_ONLY,
          status: MembershipStatus.ACTIVE,
        },
      };

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have permission to perform this action',
      );
    });

    it('should deny if membership not active', async () => {
      jest
        .spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce({
          permissions: [PERMISSIONS.TEAM_CREATE],
          mode: 'ANY',
        })
        .mockReturnValueOnce(undefined);

      const mockRequest = {
        user: { dbUserId: 'user-1' },
        orgId: 'org-1',
        membership: {
          id: 'membership-1',
          role: MembershipRole.MEMBER,
          status: MembershipStatus.INVITED,
        },
      };

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow('Membership is not active');
    });
  });
});
