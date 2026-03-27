import { ExecutionContext } from '@nestjs/common';
import { TenantContext, TenantRequest } from '../types/tenant-context';
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
            field: keyof TenantContext | undefined,
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
  await import('./current-tenant.decorator');
});

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
    expect(typeof state.extractorFn).toBe('function');
  });

  it('returns the full TenantContext when no field is specified', () => {
    const ctx = makeContext(baseCtx);
    expect(state.extractorFn!(undefined, ctx)).toBe(baseCtx);
  });

  it('returns a specific field when a field name is provided', () => {
    const ctx = makeContext(baseCtx);
    expect(state.extractorFn!('tenantId', ctx)).toBe('org-1');
    expect(state.extractorFn!('userId', ctx)).toBe('user-42');
    expect(state.extractorFn!('role', ctx)).toBe('ADMIN');
    expect(state.extractorFn!('permissions', ctx)).toEqual([
      'org.read',
      'org.manage',
    ]);
  });

  it('returns undefined when tenantContext is not set and no field specified', () => {
    const ctx = makeContext(undefined);
    expect(state.extractorFn!(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when tenantContext is not set and a field is specified', () => {
    const ctx = makeContext(undefined);
    expect(state.extractorFn!('tenantId', ctx)).toBeUndefined();
  });

  it('returns undefined when the requested field is absent from a partial context', () => {
    const partialCtx = {
      tenantId: 'org-1',
      timestamp: new Date(),
    } as TenantContext;
    const ctx = makeContext(partialCtx);
    expect(state.extractorFn!('userId', ctx)).toBeUndefined();
  });

  it('returns the timestamp object when field is "timestamp"', () => {
    const ctx = makeContext(baseCtx);
    expect(state.extractorFn!('timestamp', ctx)).toBe(baseCtx.timestamp);
  });
});
