import { OrgContextGuard, RequestWithOrgContext } from './org-context.guard';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@libs/prisma';
import {
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { MembershipStatus } from '@prisma/client';

const mockReflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
const mockPrisma = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  membership: { findUnique: jest.fn() },
} as unknown as PrismaService;

function makeContext(
  request: Partial<RequestWithOrgContext>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('OrgContextGuard', () => {
  let guard: OrgContextGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new OrgContextGuard(mockReflector, mockPrisma);
  });

  it('passes through unauthenticated request on non-org-scoped route', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(false);
    const ctx = makeContext({ user: undefined as any });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user is missing', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const ctx = makeContext({ user: undefined as any });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws BadRequestException when orgId is missing on @OrgScoped route', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const ctx = makeContext({
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: {},
      query: {},
      body: {},
      headers: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
  });

  it('passes through when orgId missing and route is NOT org-scoped', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(false);
    const ctx = makeContext({
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: {},
      query: {},
      body: {},
      headers: {},
    });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user has no membership', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const dbUser = { id: 'db-u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
    mockPrisma.user.findUnique = jest.fn().mockResolvedValue(dbUser);
    mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(null);

    const ctx = makeContext({
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: { orgId: 'org-1' },
      query: {},
      body: {},
      headers: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when membership is INACTIVE', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const dbUser = { id: 'db-u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
    mockPrisma.user.findUnique = jest.fn().mockResolvedValue(dbUser);
    mockPrisma.membership.findUnique = jest.fn().mockResolvedValue({
      id: 'm-1',
      role: 'ADMIN',
      status: 'INACTIVE' as MembershipStatus,
    });

    const ctx = makeContext({
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: { orgId: 'org-1' },
      query: {},
      body: {},
      headers: {},
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows access and populates tenantContext on valid membership', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const dbUser = { id: 'db-u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
    const membership = {
      id: 'm-1',
      role: 'ADMIN',
      status: 'ACTIVE' as MembershipStatus,
    };
    mockPrisma.user.findUnique = jest.fn().mockResolvedValue(dbUser);
    mockPrisma.membership.findUnique = jest.fn().mockResolvedValue(membership);

    const request: Partial<RequestWithOrgContext> = {
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: { orgId: 'org-1' },
      query: {},
      body: {},
      headers: {},
    };
    const ctx = makeContext(request);
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.tenantContext?.tenantId).toBe('org-1');
    expect(request.tenantContext?.userId).toBe('db-u-1');
    expect(request.tenantContext?.role).toBe('ADMIN');
  });

  it('auto-creates DB user when not found', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const newUser = { id: 'new-u', auth0Id: 'auth0|new', email: 'new@b.com' };
    mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
    mockPrisma.user.create = jest.fn().mockResolvedValue(newUser);
    mockPrisma.membership.findUnique = jest.fn().mockResolvedValue({
      id: 'm-2',
      role: 'MEMBER',
      status: 'ACTIVE' as MembershipStatus,
    });

    const request: Partial<RequestWithOrgContext> = {
      user: { sub: 'auth0|new', email: 'new@b.com' } as any,
      params: { orgId: 'org-1' },
      query: {},
      body: {},
      headers: {},
    };
    expect(await guard.canActivate(makeContext(request))).toBe(true);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: { auth0Id: 'auth0|new', email: 'new@b.com' },
    });
  });

  it('resolves orgId from x-org-id header when params are empty', async () => {
    mockReflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    const dbUser = { id: 'u-1' };
    mockPrisma.user.findUnique = jest.fn().mockResolvedValue(dbUser);
    mockPrisma.membership.findUnique = jest.fn().mockResolvedValue({
      id: 'm-1',
      role: 'ADMIN',
      status: 'ACTIVE' as MembershipStatus,
    });

    const request: Partial<RequestWithOrgContext> = {
      user: { sub: 'auth0|1', email: 'a@b.com' } as any,
      params: {},
      query: {},
      body: {},
      headers: { 'x-org-id': 'org-from-header' },
    };
    expect(await guard.canActivate(makeContext(request))).toBe(true);
    expect(request.orgId).toBe('org-from-header');
  });
});
