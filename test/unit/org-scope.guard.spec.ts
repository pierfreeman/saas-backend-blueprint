import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { OrgScopeGuard } from '../../src/common/guards/org-scope.guard';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { MembershipRole } from '@prisma/client';

describe('OrgScopeGuard', () => {
  let guard: OrgScopeGuard;
  let prismaService: any;
  let membershipsService: any;

  const mockUser = {
    sub: 'auth0|user123',
    email: 'test@example.com',
  };

  const mockDbUser = {
    id: 'user-123',
    auth0Id: 'auth0|user123',
    email: 'test@example.com',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMembership = {
    id: 'membership-123',
    userId: mockDbUser.id,
    orgId: 'org-123',
    role: MembershipRole.ADMIN,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
    } as any;

    const mockMemberships = {
      getMembershipOrThrow: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgScopeGuard,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: MembershipsService,
          useValue: mockMemberships,
        },
      ],
    }).compile();

    guard = module.get<OrgScopeGuard>(OrgScopeGuard);
    prismaService = module.get(PrismaService);
    membershipsService = module.get(MembershipsService);
  });

  const createMockContext = (params: Record<string, unknown> = {}): ExecutionContext => {
    const request = {
      user: mockUser,
      params,
      query: {},
      body: {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  };

  describe('canActivate', () => {
    it('should allow access when user has valid membership', async () => {
      const context = createMockContext({ orgId: 'org-123' });
      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockResolvedValue(mockMembership);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: mockUser.sub },
      });
      expect(membershipsService.getMembershipOrThrow).toHaveBeenCalledWith(
        mockDbUser.id,
        'org-123',
      );

      const request = context.switchToHttp().getRequest();
      expect(request.orgId).toBe('org-123');
    });

    it('should extract orgId from params', async () => {
      const context = createMockContext({ orgId: 'org-from-params' });
      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockResolvedValue(mockMembership);

      await guard.canActivate(context);

      expect(membershipsService.getMembershipOrThrow).toHaveBeenCalledWith(
        mockDbUser.id,
        'org-from-params',
      );
    });

    it('should extract orgId from query', async () => {
      const context = createMockContext({});
      const request = context.switchToHttp().getRequest();
      request.query = { orgId: 'org-from-query' };

      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockResolvedValue(mockMembership);

      await guard.canActivate(context);

      expect(membershipsService.getMembershipOrThrow).toHaveBeenCalledWith(
        mockDbUser.id,
        'org-from-query',
      );
    });

    it('should extract orgId from body', async () => {
      const context = createMockContext({});
      const request = context.switchToHttp().getRequest();
      request.body = { orgId: 'org-from-body' };

      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockResolvedValue(mockMembership);

      await guard.canActivate(context);

      expect(membershipsService.getMembershipOrThrow).toHaveBeenCalledWith(
        mockDbUser.id,
        'org-from-body',
      );
    });

    it('should prioritize params over query and body', async () => {
      const context = createMockContext({ orgId: 'org-from-params' });
      const request = context.switchToHttp().getRequest();
      request.query = { orgId: 'org-from-query' };
      request.body = { orgId: 'org-from-body' };

      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockResolvedValue(mockMembership);

      await guard.canActivate(context);

      expect(membershipsService.getMembershipOrThrow).toHaveBeenCalledWith(
        mockDbUser.id,
        'org-from-params',
      );
    });

    it('should throw ForbiddenException when user not authenticated', async () => {
      const context = createMockContext({ orgId: 'org-123' });
      const request = context.switchToHttp().getRequest();
      request.user = undefined;

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when orgId missing', async () => {
      const context = createMockContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when orgId is not a string', async () => {
      const context = createMockContext({ orgId: 123 });

      await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user not found in database', async () => {
      const context = createMockContext({ orgId: 'org-123' });
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      expect(membershipsService.getMembershipOrThrow).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when membership verification fails', async () => {
      const context = createMockContext({ orgId: 'org-123' });
      prismaService.user.findUnique.mockResolvedValue(mockDbUser);
      membershipsService.getMembershipOrThrow.mockRejectedValue(
        new ForbiddenException('No access'),
      );

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
