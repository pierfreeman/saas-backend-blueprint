import { vi } from 'vitest';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersService } from '@libs/users';
import { SystemAdminGuard, AdminRequest } from './system-admin.guard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AUTH0_ID = 'auth0|admin123';

function makeDbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: ADMIN_USER_ID,
    auth0Id: AUTH0_ID,
    email: 'admin@example.com',
    isSystemAdmin: true,
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<AdminRequest> = {},
): Partial<AdminRequest> {
  return {
    user: { sub: AUTH0_ID, email: 'admin@example.com' },
    ...overrides,
  };
}

function makeContext(request: Partial<AdminRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: vi.fn(),
    getClass: vi.fn(),
  } as unknown as ExecutionContext;
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockUsersService = {
  findByAuth0Id: vi.fn(),
} as unknown as UsersService;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SystemAdminGuard', () => {
  let guard: SystemAdminGuard;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        SystemAdminGuard,
        { provide: UsersService, useValue: mockUsersService },
      ],
    }).compile();

    guard = module.get(SystemAdminGuard);
  });

  it('allows a verified system admin and injects dbUserId', async () => {
    const request = makeRequest();
    (
      mockUsersService.findByAuth0Id as ReturnType<typeof vi.fn>
    ).mockResolvedValue(makeDbUser());

    const result = await guard.canActivate(makeContext(request));

    expect(result).toBe(true);
    expect(request.user?.dbUserId).toBe(ADMIN_USER_ID);
  });

  it('throws ForbiddenException when user is not a system admin', async () => {
    (
      mockUsersService.findByAuth0Id as ReturnType<typeof vi.fn>
    ).mockResolvedValue(makeDbUser({ isSystemAdmin: false }));

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws ForbiddenException when the DB user does not exist', async () => {
    (
      mockUsersService.findByAuth0Id as ReturnType<typeof vi.fn>
    ).mockResolvedValue(null);

    await expect(
      guard.canActivate(makeContext(makeRequest())),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws UnauthorizedException when request.user.sub is missing', async () => {
    const request = makeRequest({ user: { sub: '', email: '' } });

    await expect(
      guard.canActivate(makeContext(request)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
