import { UnauthorizedException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';
import { TenantContext, TenantRequest } from '../types/tenant-context';
import { Request } from 'express';

function makeRequest(ctx?: TenantContext): Request & TenantRequest {
  return { tenantContext: ctx } as unknown as Request & TenantRequest;
}

describe('TenantContextService', () => {
  const baseCtx: TenantContext = {
    tenantId: 'org-1',
    timestamp: new Date('2025-01-01'),
  };

  it('getContext() returns the context when present', () => {
    const svc = new TenantContextService(makeRequest(baseCtx));
    expect(svc.getContext()).toBe(baseCtx);
  });

  it('getContext() throws UnauthorizedException when context is missing', () => {
    const svc = new TenantContextService(makeRequest(undefined));
    expect(() => svc.getContext()).toThrow(UnauthorizedException);
  });

  it('tenantId getter returns the correct id', () => {
    const svc = new TenantContextService(makeRequest(baseCtx));
    expect(svc.tenantId).toBe('org-1');
  });

  it('userId getter is undefined when not enriched', () => {
    const svc = new TenantContextService(makeRequest(baseCtx));
    expect(svc.userId).toBeUndefined();
  });

  it('userId getter returns value after enrichment', () => {
    const ctx: TenantContext = { ...baseCtx, userId: 'user-42' };
    const svc = new TenantContextService(makeRequest(ctx));
    expect(svc.userId).toBe('user-42');
  });

  it('role getter returns undefined when not set', () => {
    const svc = new TenantContextService(makeRequest(baseCtx));
    expect(svc.role).toBeUndefined();
  });

  it('permissions getter returns empty array when not set', () => {
    const svc = new TenantContextService(makeRequest(baseCtx));
    expect(svc.permissions).toEqual([]);
  });

  it('permissions getter returns populated array when set', () => {
    const ctx: TenantContext = { ...baseCtx, permissions: ['org.read'] };
    const svc = new TenantContextService(makeRequest(ctx));
    expect(svc.permissions).toEqual(['org.read']);
  });

  it('enrich() merges partial data into the existing context', () => {
    const ctx: TenantContext = { ...baseCtx };
    const req = makeRequest(ctx);
    const svc = new TenantContextService(req);

    svc.enrich({ userId: 'u-1', role: 'ADMIN', permissions: ['org.manage'] });

    expect(req.tenantContext?.userId).toBe('u-1');
    expect(req.tenantContext?.role).toBe('ADMIN');
    expect(req.tenantContext?.permissions).toEqual(['org.manage']);
    // original fields unchanged
    expect(req.tenantContext?.tenantId).toBe('org-1');
  });

  it('enrich() is a no-op when tenantContext is undefined', () => {
    const req = makeRequest(undefined);
    const svc = new TenantContextService(req);
    expect(() => svc.enrich({ userId: 'x' })).not.toThrow();
  });
});
