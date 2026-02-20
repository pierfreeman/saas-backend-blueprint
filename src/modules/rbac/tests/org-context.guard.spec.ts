import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgContextGuard } from '../guards/org-context.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { MembershipsService } from '../../memberships/memberships.service';
import { MembershipStatus, MembershipRole } from '@prisma/client';

describe('OrgContextGuard', () => {
  let guard: OrgContextGuard;
  let prisma: PrismaService;
  let memberships: MembershipsService;
  let reflector: Reflector;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
  };

  const mockMembershipsService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgContextGuard,
        Reflector,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MembershipsService,
          useValue: mockMembershipsService,
        },
      ],
    }).compile();

    guard = module.get<OrgContextGuard>(OrgContextGuard);
    prisma = module.get<PrismaService>(PrismaService);
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
    it('should throw if user not authenticated', async () => {
      const mockRequest = {
        user: null,
        params: { orgId: 'org-1' },
      };

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('should allow if no orgId and not org-scoped', async () => {
      const mockRequest = {
        user: { sub: 'auth0|123', email: 'user@test.com' },
        params: {},
        query: {},
        body: {},
        headers: {},
      };

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      const context = createMockContext(mockRequest);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should reject if membership not found', async () => {
      const mockRequest = {
        user: { sub: 'auth0|123', email: 'user@test.com' },
        params: { orgId: 'org-1' },
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        auth0Id: 'auth0|123',
        email: 'user@test.com',
      });

      mockPrismaService.membership.findUnique.mockResolvedValue(null);

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'You are not a member of this organization',
      );
    });

    it('should reject if membership not active', async () => {
      const mockRequest = {
        user: { sub: 'auth0|123', email: 'user@test.com' },
        params: { orgId: 'org-1' },
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        auth0Id: 'auth0|123',
        email: 'user@test.com',
      });

      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
        status: MembershipStatus.SUSPENDED,
      });

      const context = createMockContext(mockRequest);

      await expect(guard.canActivate(context)).rejects.toThrow('Membership is suspended');
    });

    it('should allow if membership is active and inject context', async () => {
      const mockRequest: any = {
        user: { sub: 'auth0|123', email: 'user@test.com' },
        params: { orgId: 'org-1' },
      };

      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        auth0Id: 'auth0|123',
        email: 'user@test.com',
      });

      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      });

      const context = createMockContext(mockRequest);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockRequest.orgId).toBe('org-1');
      expect(mockRequest.user.dbUserId).toBe('user-1');
      expect(mockRequest.membership).toEqual({
        id: 'membership-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      });
    });

    it('should auto-create user if not exists', async () => {
      const mockRequest = {
        user: { sub: 'auth0|new', email: 'newuser@test.com' },
        params: { orgId: 'org-1' },
      };

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        id: 'user-new',
        auth0Id: 'auth0|new',
        email: 'newuser@test.com',
      });

      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-new',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
      });

      const context = createMockContext(mockRequest);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(mockPrismaService.user.create).toHaveBeenCalled();
    });
  });
});
