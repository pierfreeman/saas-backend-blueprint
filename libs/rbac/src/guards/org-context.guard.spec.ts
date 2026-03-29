import { vi } from 'vitest';
import { OrgContextGuard, RequestWithOrgContext } from './org-context.guard';
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '@libs/users';
import { MembershipsService } from '@libs/memberships';
import { OrganizationsService } from '@libs/organizations';
import { MembershipStatus } from '@prisma/client';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockReflector = {
  getAllAndOverride: vi.fn(),
} as unknown as Reflector;

const mockUsersService = {
  findByAuth0Id: vi.fn(),
  createUser: vi.fn(),
} as unknown as UsersService;

const mockMembershipsService = {
  findByUserAndOrg: vi.fn(),
} as unknown as MembershipsService;

const mockOrgsService = {
  findById: vi.fn(),
} as unknown as OrganizationsService;

const USER_ID = 'user-uuid-1';
const ORG_ID = 'org-uuid-1';
const AUTH0_ID = 'auth0|123456';

function makeRequest(overrides: Partial<RequestWithOrgContext> = {}): Partial<RequestWithOrgContext> {
  return {
    user: { sub: AUTH0_ID, email: 'test@example.com' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ...overrides,
  };
}

function makeContext(request: Partial<RequestWithOrgContext>): ExecutionContext {
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
  } as unknown as ExecutionContext;
}

describe('OrgContextGuard', () => {
  let guard: OrgContextGuard;

  beforeEach(() => {
    vi.clearAllMocks();
    guard = new OrgContextGuard(
      mockReflector,
      mockUsersService,
      mockMembershipsService,
      mockOrgsService,
    );
  });

  // ── Org Found via Route Param ──────────────────────────────────────────────

  describe('org found via route param', () => {
    it('attaches orgId and membership to request when org is found in params.orgId', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'ADMIN',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.orgId).toBe(ORG_ID);
      expect(request.user?.dbUserId).toBe(USER_ID);
      expect(request.membership).toEqual({
        id: membership.id,
        role: membership.role,
        status: membership.status,
      });
      expect(request.tenantContext).toBeDefined();
      expect(request.tenantContext?.tenantId).toBe(ORG_ID);
      expect(request.tenantContext?.userId).toBe(USER_ID);
    });

    it('reads orgId from params.id when params.orgId is not present', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'OWNER',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ params: { id: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.orgId).toBe(ORG_ID);
    });
  });

  // ── Org Found via Query Param ──────────────────────────────────────────────

  describe('org found via query param', () => {
    it('reads orgId from query param when route param is absent', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'MEMBER',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ query: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.orgId).toBe(ORG_ID);
    });

    it('reads orgId from body when route and query params are absent', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'READ_ONLY',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ body: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.orgId).toBe(ORG_ID);
    });

    it('reads orgId from x-org-id header when other sources are absent', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'ADMIN',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ headers: { 'x-org-id': ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.orgId).toBe(ORG_ID);
    });
  });

  // ── Org Not Found ──────────────────────────────────────────────────────────

  describe('org not found', () => {
    it('throws BadRequestException when route is @OrgScoped but no orgId provided', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(true);

      const request = makeRequest();
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Organization ID is required',
      );
    });

    it('passes through (returns true) when no orgId and route is not @OrgScoped', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const request = makeRequest();
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(mockUsersService.findByAuth0Id).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when membership is not found but org exists', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);
      mockOrgsService.findById = vi.fn().mockResolvedValue({ id: ORG_ID });

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'You are not a member of this organization',
      );
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(null);
      mockOrgsService.findById = vi.fn().mockRejectedValue(new NotFoundException());

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
    });
  });

  // ── User Auto-Creation ─────────────────────────────────────────────────────

  describe('user auto-creation', () => {
    it('auto-creates DB user when not found', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const newUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'MEMBER',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(null);
      mockUsersService.createUser = vi.fn().mockResolvedValue(newUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        AUTH0_ID,
        'test@example.com',
      );
      expect(result).toBe(true);
      expect(request.user?.dbUserId).toBe(USER_ID);
    });

    it('uses fallback email when user.email is not present', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const newUser = { id: USER_ID, email: `${AUTH0_ID}@unknown.local`, auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'MEMBER',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(null);
      mockUsersService.createUser = vi.fn().mockResolvedValue(newUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({
        params: { orgId: ORG_ID },
        user: { sub: AUTH0_ID, email: undefined },
      });
      const ctx = makeContext(request);

      await guard.canActivate(ctx);

      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        AUTH0_ID,
        `${AUTH0_ID}@unknown.local`,
      );
    });
  });

  // ── Membership Status ──────────────────────────────────────────────────────

  describe('membership status', () => {
    it('throws ForbiddenException when membership is INACTIVE', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'MEMBER',
        status: 'INACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Membership is inactive');
    });

    it('allows access when membership is ACTIVE', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const dbUser = { id: USER_ID, email: 'test@example.com', auth0Id: AUTH0_ID };
      const membership = {
        id: 'membership-1',
        userId: USER_ID,
        orgId: ORG_ID,
        role: 'OWNER',
        status: MembershipStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByAuth0Id = vi.fn().mockResolvedValue(dbUser);
      mockMembershipsService.findByUserAndOrg = vi.fn().mockResolvedValue(membership);

      const request = makeRequest({ params: { orgId: ORG_ID } });
      const ctx = makeContext(request);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
    });
  });

  // ── User Authentication ────────────────────────────────────────────────────

  describe('user authentication', () => {
    it('throws ForbiddenException when user is not authenticated', async () => {
      mockReflector.getAllAndOverride = vi.fn().mockReturnValue(false);

      const request = makeRequest({ user: undefined });
      const ctx = makeContext(request);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('User not authenticated');
    });
  });
});
