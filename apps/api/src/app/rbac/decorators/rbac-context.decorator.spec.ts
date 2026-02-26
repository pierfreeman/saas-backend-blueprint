import { ExecutionContext } from '@nestjs/common';

/**
 * Capture the three extractor callbacks registered by createParamDecorator.
 * jest.mock is hoisted above all imports so the intercept is active before
 * the module under test is first loaded.
 */
let extractCurrentUserId: (_data: unknown, ctx: ExecutionContext) => unknown;
let extractCurrentOrgId: (_data: unknown, ctx: ExecutionContext) => unknown;
let extractRBACContext: (_data: unknown, ctx: ExecutionContext) => unknown;

let callCount = 0;
jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual(
    '@nestjs/common',
  ) as typeof import('@nestjs/common');
  return {
    ...actual,
    createParamDecorator: (fn: any) => {
      callCount++;
      if (callCount === 1) extractCurrentUserId = fn;
      else if (callCount === 2) extractCurrentOrgId = fn;
      else extractRBACContext = fn;
      return actual.createParamDecorator(fn);
    },
  };
});

// Load the module AFTER the mock is in place.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./rbac-context.decorator');

function makeContext(
  requestOverrides: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => requestOverrides,
    }),
  } as unknown as ExecutionContext;
}

// -------------------------------------------------------------------------
describe('CurrentUserId decorator', () => {
  it('returns dbUserId from request.user when present', () => {
    const ctx = makeContext({ user: { dbUserId: 'db-u-1' } });
    expect(extractCurrentUserId(undefined, ctx)).toBe('db-u-1');
  });

  it('returns undefined when user is absent', () => {
    const ctx = makeContext({});
    expect(extractCurrentUserId(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when user exists but dbUserId is not set', () => {
    const ctx = makeContext({ user: {} });
    expect(extractCurrentUserId(undefined, ctx)).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
describe('CurrentOrgId decorator', () => {
  it('returns orgId from the request when present', () => {
    const ctx = makeContext({ orgId: 'org-42' });
    expect(extractCurrentOrgId(undefined, ctx)).toBe('org-42');
  });

  it('returns undefined when orgId is absent', () => {
    const ctx = makeContext({});
    expect(extractCurrentOrgId(undefined, ctx)).toBeUndefined();
  });
});

// -------------------------------------------------------------------------
describe('RBACContext decorator', () => {
  it('returns full RBAC context when all fields are populated', () => {
    const ctx = makeContext({
      user: { dbUserId: 'db-u-1' },
      orgId: 'org-1',
      rbacRole: 'ADMIN',
      rbacPermissions: ['org.read', 'org.manage'],
    });

    expect(extractRBACContext(undefined, ctx)).toEqual({
      userId: 'db-u-1',
      orgId: 'org-1',
      role: 'ADMIN',
      permissions: ['org.read', 'org.manage'],
    });
  });

  it('returns all fields as undefined when request has no RBAC context', () => {
    const ctx = makeContext({});
    expect(extractRBACContext(undefined, ctx)).toEqual({
      userId: undefined,
      orgId: undefined,
      role: undefined,
      permissions: undefined,
    });
  });

  it('returns undefined userId when user exists but dbUserId is missing', () => {
    const ctx = makeContext({ user: {}, orgId: 'org-1' });
    const result = extractRBACContext(undefined, ctx) as any;
    expect(result.userId).toBeUndefined();
    expect(result.orgId).toBe('org-1');
  });

  it('returns undefined permissions when rbacPermissions is not set', () => {
    const ctx = makeContext({
      user: { dbUserId: 'db-u-1' },
      orgId: 'org-1',
      rbacRole: 'MEMBER',
    });
    const result = extractRBACContext(undefined, ctx) as any;
    expect(result.permissions).toBeUndefined();
    expect(result.role).toBe('MEMBER');
  });
});
