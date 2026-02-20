import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from '../../src/common/guards/roles.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { MembershipRole } from '@prisma/client';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: any;
  let prisma: any;
  let membershipsService: any;

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
    };

    const mockMembershipsService = {
      hasRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MembershipsService, useValue: mockMembershipsService },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
    prisma = module.get(PrismaService);
    membershipsService = module.get(MembershipsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (user?: any, orgId?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          orgId,
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  describe('canActivate', () => {
    it('should allow access when no roles are required', async () => {
      reflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('should allow access when empty roles array', async () => {
      reflector.getAllAndOverride.mockReturnValue([]);
      const context = createMockContext();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should throw ForbiddenException when user not authenticated', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.ADMIN]);
      const context = createMockContext(undefined, 'org-123');

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('User not authenticated');
    });

    it('should throw ForbiddenException when orgId not found', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.ADMIN]);
      const context = createMockContext({ sub: 'auth0|123' }, undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Organization context not found');
    });

    it('should throw ForbiddenException when user not found in database', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.ADMIN]);
      const context = createMockContext({ sub: 'auth0|123' }, 'org-123');

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('User not found');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|123' },
      });
    });

    it('should allow access when user has required role', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.ADMIN]);
      const context = createMockContext({ sub: 'auth0|123' }, 'org-123');
      const mockUser = { id: 'user-123', auth0Id: 'auth0|123', email: 'test@example.com' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      membershipsService.hasRole.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|123' },
      });
      expect(membershipsService.hasRole).toHaveBeenCalledWith(mockUser.id, 'org-123', [
        MembershipRole.ADMIN,
      ]);
    });

    it('should allow access when user has one of multiple required roles', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.OWNER, MembershipRole.ADMIN]);
      const context = createMockContext({ sub: 'auth0|123' }, 'org-123');
      const mockUser = { id: 'user-123', auth0Id: 'auth0|123', email: 'test@example.com' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      membershipsService.hasRole.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(membershipsService.hasRole).toHaveBeenCalledWith(mockUser.id, 'org-123', [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
      ]);
    });

    it('should deny access when user does not have required role', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.OWNER]);
      const context = createMockContext({ sub: 'auth0|123' }, 'org-123');
      const mockUser = { id: 'user-123', auth0Id: 'auth0|123', email: 'test@example.com' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      membershipsService.hasRole.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'You do not have the required role to perform this action',
      );
      expect(membershipsService.hasRole).toHaveBeenCalledWith(mockUser.id, 'org-123', [
        MembershipRole.OWNER,
      ]);
    });

    it('should check roles for COACH role', async () => {
      reflector.getAllAndOverride.mockReturnValue([MembershipRole.COACH]);
      const context = createMockContext({ sub: 'auth0|456' }, 'org-456');
      const mockUser = { id: 'user-456', auth0Id: 'auth0|456', email: 'coach@example.com' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      membershipsService.hasRole.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(membershipsService.hasRole).toHaveBeenCalledWith(mockUser.id, 'org-456', [
        MembershipRole.COACH,
      ]);
    });

    it('should check roles for VIEWER role', async () => {
      reflector.getAllAndOverride.mockReturnValue([
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.COACH,
        MembershipRole.VIEWER,
      ]);
      const context = createMockContext({ sub: 'auth0|789' }, 'org-789');
      const mockUser = { id: 'user-789', auth0Id: 'auth0|789', email: 'viewer@example.com' };

      prisma.user.findUnique.mockResolvedValue(mockUser);
      membershipsService.hasRole.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(membershipsService.hasRole).toHaveBeenCalledWith(mockUser.id, 'org-789', [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.COACH,
        MembershipRole.VIEWER,
      ]);
    });
  });
});
