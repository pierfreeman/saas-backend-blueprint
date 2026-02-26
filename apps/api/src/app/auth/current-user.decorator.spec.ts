import { ExecutionContext } from '@nestjs/common';
import { RequestUser } from '@libs/common';

/**
 * Capture the extractor callback registered by createParamDecorator.
 * jest.mock is hoisted so it is active before the module is loaded.
 */
let extractorFn: (
  data: keyof RequestUser | undefined,
  ctx: ExecutionContext,
) => unknown;

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual(
    '@nestjs/common',
  ) as typeof import('@nestjs/common');
  return {
    ...actual,
    createParamDecorator: (fn: any) => {
      extractorFn = fn;
      return actual.createParamDecorator(fn);
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./current-user.decorator');

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
    expect(typeof extractorFn).toBe('function');
  });

  it('returns the full user object when no field key is specified', () => {
    const ctx = makeContext(baseUser);
    expect(extractorFn(undefined, ctx)).toBe(baseUser);
  });

  it('returns a specific field when a key is provided', () => {
    const ctx = makeContext(baseUser);
    expect(extractorFn('sub', ctx)).toBe('auth0|u1');
    expect(extractorFn('email', ctx)).toBe('user@example.com');
  });

  it('returns undefined when the user is not set on the request', () => {
    const ctx = makeContext(undefined);
    expect(extractorFn(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined for any key when user is not set', () => {
    const ctx = makeContext(undefined);
    expect(extractorFn('sub', ctx)).toBeUndefined();
    expect(extractorFn('email', ctx)).toBeUndefined();
  });

  it('returns undefined when the specified field does not exist on the user', () => {
    const ctx = makeContext(baseUser);
    // Cast to any to simulate accessing a non-existent field at runtime
    expect(extractorFn('nonExistentField' as any, ctx)).toBeUndefined();
  });
});
