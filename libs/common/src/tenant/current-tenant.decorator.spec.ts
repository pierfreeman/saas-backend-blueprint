import { ExecutionContext } from '@nestjs/common';
import { TenantContext, TenantRequest } from '../types/tenant-context';

/**
 * Capture the extractor callback registered by createParamDecorator.
 * jest.mock is hoisted by Jest before any import/require statements run,
 * so `extractorFn` will be populated when the module is first loaded.
 */
let extractorFn: (
  field: keyof TenantContext | undefined,
  ctx: ExecutionContext,
) => unknown;

jest.mock('@nestjs/common', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// Import AFTER the mock factory is declared (hoisting ensures the mock is
// active before the module code runs).
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('./current-tenant.decorator');

function makeContext(tenantContext?: TenantContext): ExecutionContext {
  const request: Partial<TenantRequest> = { tenantContext };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentTenant decorator', () => {
  const baseCtx: TenantContext = {
    tenantId: 'org-1',
    userId: 'user-42',
    role: 'ADMIN',
    permissions: ['org.read', 'org.manage'],
    timestamp: new Date('2025-01-01'),
  };

  it('captures the extractor callback via createParamDecorator', () => {
    expect(typeof extractorFn).toBe('function');
  });

  it('returns the full TenantContext when no field is specified', () => {
    const ctx = makeContext(baseCtx);
    expect(extractorFn(undefined, ctx)).toBe(baseCtx);
  });

  it('returns a specific field when a field name is provided', () => {
    const ctx = makeContext(baseCtx);
    expect(extractorFn('tenantId', ctx)).toBe('org-1');
    expect(extractorFn('userId', ctx)).toBe('user-42');
    expect(extractorFn('role', ctx)).toBe('ADMIN');
    expect(extractorFn('permissions', ctx)).toEqual(['org.read', 'org.manage']);
  });

  it('returns undefined when tenantContext is not set and no field specified', () => {
    const ctx = makeContext(undefined);
    expect(extractorFn(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when tenantContext is not set and a field is specified', () => {
    const ctx = makeContext(undefined);
    expect(extractorFn('tenantId', ctx)).toBeUndefined();
  });

  it('returns undefined when the requested field is absent from a partial context', () => {
    const partialCtx = {
      tenantId: 'org-1',
      timestamp: new Date(),
    } as TenantContext;
    const ctx = makeContext(partialCtx);
    expect(extractorFn('userId', ctx)).toBeUndefined();
  });

  it('returns the timestamp object when field is "timestamp"', () => {
    const ctx = makeContext(baseCtx);
    expect(extractorFn('timestamp', ctx)).toBe(baseCtx.timestamp);
  });
});
