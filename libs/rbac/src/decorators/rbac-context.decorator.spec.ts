import { ExecutionContext } from '@nestjs/common';
import { vi } from 'vitest';

/**
 * Capture the extractor callbacks registered by createParamDecorator.
 * vi.hoisted() ensures the variables are available when the hoisted vi.mock()
 * factory runs (before module variable declarations are processed in ESM).
 */
const state = vi.hoisted(
  () =>
    ({
      currentUserIdExtractor: undefined,
      currentOrgIdExtractor: undefined,
      rbacContextExtractor: undefined,
    }) as {
      currentUserIdExtractor:
        | ((data: unknown, ctx: ExecutionContext) => unknown)
        | undefined;
      currentOrgIdExtractor:
        | ((data: unknown, ctx: ExecutionContext) => unknown)
        | undefined;
      rbacContextExtractor:
        | ((data: unknown, ctx: ExecutionContext) => unknown)
        | undefined;
    },
);

vi.mock('@nestjs/common', async (importActual) => {
  const actual = await importActual<typeof import('@nestjs/common')>();
  let callCount = 0;
  return {
    ...actual,
    createParamDecorator: (fn: any) => {
      // The decorators are loaded in order: CurrentUserId, CurrentOrgId, RBACContext
      if (callCount === 0) {
        state.currentUserIdExtractor = fn;
      } else if (callCount === 1) {
        state.currentOrgIdExtractor = fn;
      } else if (callCount === 2) {
        state.rbacContextExtractor = fn;
      }
      callCount++;
      return actual.createParamDecorator(fn);
    },
  };
});

// Load the decorators after the mock is registered
beforeAll(async () => {
  await import('./rbac-context.decorator');
});

interface MockRequest {
  user?: { dbUserId?: string };
  orgId?: string;
  rbacRole?: string;
  rbacPermissions?: string[];
}

function makeContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentUserId decorator', () => {
  it('captures the extractor callback via createParamDecorator', () => {
    expect(typeof state.currentUserIdExtractor).toBe('function');
  });

  it('returns the dbUserId when user is set', () => {
    const ctx = makeContext({ user: { dbUserId: 'user-123' } });
    expect(state.currentUserIdExtractor!(undefined, ctx)).toBe('user-123');
  });

  it('returns undefined when user is not set', () => {
    const ctx = makeContext({});
    expect(state.currentUserIdExtractor!(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when user is set but dbUserId is not', () => {
    const ctx = makeContext({ user: {} });
    expect(state.currentUserIdExtractor!(undefined, ctx)).toBeUndefined();
  });
});

describe('CurrentOrgId decorator', () => {
  it('captures the extractor callback via createParamDecorator', () => {
    expect(typeof state.currentOrgIdExtractor).toBe('function');
  });

  it('returns the orgId when set', () => {
    const ctx = makeContext({ orgId: 'org-456' });
    expect(state.currentOrgIdExtractor!(undefined, ctx)).toBe('org-456');
  });

  it('returns undefined when orgId is not set', () => {
    const ctx = makeContext({});
    expect(state.currentOrgIdExtractor!(undefined, ctx)).toBeUndefined();
  });
});

describe('RBACContext decorator', () => {
  it('captures the extractor callback via createParamDecorator', () => {
    expect(typeof state.rbacContextExtractor).toBe('function');
  });

  it('returns full RBAC context when all fields are set', () => {
    const ctx = makeContext({
      user: { dbUserId: 'user-789' },
      orgId: 'org-123',
      rbacRole: 'ADMIN',
      rbacPermissions: ['org.read', 'org.manage'],
    });

    const result = state.rbacContextExtractor!(undefined, ctx);

    expect(result).toEqual({
      userId: 'user-789',
      orgId: 'org-123',
      role: 'ADMIN',
      permissions: ['org.read', 'org.manage'],
    });
  });

  it('returns context with undefined fields when request has no RBAC data', () => {
    const ctx = makeContext({});

    const result = state.rbacContextExtractor!(undefined, ctx);

    expect(result).toEqual({
      userId: undefined,
      orgId: undefined,
      role: undefined,
      permissions: undefined,
    });
  });

  it('returns partial context when only some fields are set', () => {
    const ctx = makeContext({
      user: { dbUserId: 'user-999' },
      orgId: 'org-888',
    });

    const result = state.rbacContextExtractor!(undefined, ctx);

    expect(result).toEqual({
      userId: 'user-999',
      orgId: 'org-888',
      role: undefined,
      permissions: undefined,
    });
  });
});
