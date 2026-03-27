import { TenantMiddleware } from './tenant.middleware';
import { Request, Response, NextFunction } from 'express';
import { TenantRequest } from '../types/tenant-context';
import { vi } from 'vitest';

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;
  let mockNext: NextFunction;
  let mockRes: Response;

  beforeEach(() => {
    middleware = new TenantMiddleware();
    mockNext = vi.fn();
    mockRes = {} as Response;
  });

  const makeReq = (
    headers: Record<string, string> = {},
    params: Record<string, string> = {},
  ): Request & TenantRequest =>
    ({ headers, params }) as unknown as Request & TenantRequest;

  it('sets tenantContext from x-org-id header (priority 1)', () => {
    const req = makeReq({ 'x-org-id': 'org-123', 'x-tenant-id': 'old-id' });
    middleware.use(req, mockRes, mockNext);
    expect(req.tenantContext?.tenantId).toBe('org-123');
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('falls back to x-tenant-id header when x-org-id is absent', () => {
    const req = makeReq({ 'x-tenant-id': 'tenant-abc' });
    middleware.use(req, mockRes, mockNext);
    expect(req.tenantContext?.tenantId).toBe('tenant-abc');
  });

  it('falls back to :orgId route param when headers are absent', () => {
    const req = makeReq({}, { orgId: 'org-from-param' });
    middleware.use(req, mockRes, mockNext);
    expect(req.tenantContext?.tenantId).toBe('org-from-param');
  });

  it('sets a timestamp when context is created', () => {
    const before = new Date();
    const req = makeReq({ 'x-org-id': 'org-ts' });
    middleware.use(req, mockRes, mockNext);
    const after = new Date();
    expect(req.tenantContext?.timestamp.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(req.tenantContext?.timestamp.getTime()).toBeLessThanOrEqual(
      after.getTime(),
    );
  });

  it('leaves tenantContext undefined when no identifier is present', () => {
    const req = makeReq({}, {});
    middleware.use(req, mockRes, mockNext);
    expect(req.tenantContext).toBeUndefined();
  });

  it('always calls next()', () => {
    const req = makeReq({});
    middleware.use(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});
