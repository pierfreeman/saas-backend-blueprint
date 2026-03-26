import { ExecutionContext } from '@nestjs/common';
import { RequestUser } from '@libs/common';
import { vi } from 'vitest';

/**
 * Capture the extractor callback registered by createParamDecorator.
 * vi.hoisted() ensures the variable is available when the hoisted vi.mock()
 * factory runs (before module variable declarations are processed in ESM).
 */
const state = vi.hoisted(
  () =>
    ({ extractorFn: undefined }) as {
      extractorFn:
        | ((
            data: keyof RequestUser | undefined,
            ctx: ExecutionContext,
          ) => unknown)
        | undefined;
    },
);

vi.mock('@nestjs/common', async (importActual) => {
  const actual = await importActual<typeof import('@nestjs/common')>();
  return {
    ...actual,
    createParamDecorator: (fn: any) => {
      state.extractorFn = fn;
      return actual.createParamDecorator(fn);
    },
  };
});

// Load the decorator after the mock is registered so createParamDecorator
// is intercepted and extractorFn is populated.
beforeAll(async () => {
  await import('./current-user.decorator');
});

const baseUser: RequestUser = {
  sub: 'auth0|u1',
  email: 'user@example.com',
};

function makeContext(user: RequestUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser decorator', () => {
  it('captures the extractor callback via createParamDecorator', () => {
    expect(typeof state.extractorFn).toBe('function');
  });

  it('returns the full user object when no field key is specified', () => {
    const ctx = makeContext(baseUser);
    expect(state.extractorFn!(undefined, ctx)).toBe(baseUser);
  });

  it('returns a specific field when a key is provided', () => {
    const ctx = makeContext(baseUser);
    expect(state.extractorFn!('sub', ctx)).toBe('auth0|u1');
    expect(state.extractorFn!('email', ctx)).toBe('user@example.com');
  });

  it('returns undefined when the user is not set on the request', () => {
    const ctx = makeContext(undefined);
    expect(state.extractorFn!(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined for any key when user is not set', () => {
    const ctx = makeContext(undefined);
    expect(state.extractorFn!('sub', ctx)).toBeUndefined();
    expect(state.extractorFn!('email', ctx)).toBeUndefined();
  });

  it('returns undefined when the specified field does not exist on the user', () => {
    const ctx = makeContext(baseUser);
    // Cast to any to simulate accessing a non-existent field at runtime
    expect(state.extractorFn!('nonExistentField' as any, ctx)).toBeUndefined();
  });
});
