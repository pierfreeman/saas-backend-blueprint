/**
 * RateLimitInterceptor — unit tests
 *
 * Distributed Redis-backed rate limiter with three axes:
 *  1. Per-IP   — always evaluated
 *  2. Per-User — only when req.user.sub is present
 *  3. Per-Tenant — only when req.tenantContext.tenantId is present
 *
 * On limit exceeded: 429 + Retry-After header + LegalAudit event.
 * Routes decorated with @SkipRateLimit() bypass the limiter entirely.
 */
import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RateLimitService } from '../services/rate-limit.service';
import type { RateLimitResult } from '../services/rate-limit.service';

// Mock @libs/legal-audit to avoid compiling Prisma-generated client in unit tests
jest.mock('@libs/legal-audit', () => ({
  LegalAuditService: class MockLegalAuditService {
    recordEvent = jest.fn();
  },
  LegalAuditModule: { module: class {} },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LegalAuditService } = require('@libs/legal-audit') as {
  LegalAuditService: new () => { recordEvent: jest.Mock };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RequestStub {
  headers?: Record<string, string>;
  url?: string;
  method?: string;
  user?: { sub?: string };
  tenantContext?: { tenantId?: string };
}

function makeAllowed(
  overrides: Partial<RateLimitResult> = {},
): RateLimitResult {
  return {
    allowed: true,
    remaining: 99,
    resetAt: 9999999999,
    count: 1,
    ...overrides,
  };
}

function makeExceeded(resetAt = 9999999999): RateLimitResult {
  return { allowed: false, remaining: 0, resetAt, count: 100 };
}

function makeContext(
  req: RequestStub,
  skipRateLimit = false,
): ExecutionContext {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn(),
    __headers: headers,
  };

  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: req.headers ?? { 'x-forwarded-for': '1.2.3.4' },
        url: req.url ?? '/api/test',
        method: req.method ?? 'GET',
        user: req.user,
        tenantContext: req.tenantContext,
        socket: { remoteAddress: '1.2.3.4' },
      }),
      getResponse: () => res,
    }),
    __resMock: res,
  } as unknown as ExecutionContext & { __resMock: typeof res };
}

function makeNext(): CallHandler {
  return { handle: () => of('ok') };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RateLimitInterceptor', () => {
  let interceptor: RateLimitInterceptor;
  let rateLimitService: jest.Mocked<RateLimitService>;
  let legalAuditService: { recordEvent: jest.Mock };
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const rls = {
      checkByIp: jest.fn().mockResolvedValue(makeAllowed()),
      checkByUser: jest.fn().mockResolvedValue(makeAllowed()),
      checkByTenant: jest.fn().mockResolvedValue(makeAllowed()),
    };
    const las = new LegalAuditService();
    const ref = { getAllAndOverride: jest.fn().mockReturnValue(false) };

    const module = await Test.createTestingModule({
      providers: [
        RateLimitInterceptor,
        { provide: RateLimitService, useValue: rls },
        { provide: LegalAuditService, useValue: las },
        { provide: Reflector, useValue: ref },
      ],
    }).compile();

    interceptor = module.get(RateLimitInterceptor);
    rateLimitService =
      module.get<jest.Mocked<RateLimitService>>(RateLimitService);
    legalAuditService = module.get<{ recordEvent: jest.Mock }>(
      LegalAuditService,
    );
    reflector = module.get<jest.Mocked<Reflector>>(Reflector);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Non-HTTP contexts ─────────────────────────────────────────────────────

  describe('non-HTTP contexts', () => {
    it('passes through for WebSocket requests without calling any rate limit check', async () => {
      const wsCtx = {
        getType: () => 'ws',
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;
      const next = makeNext();
      const spy = jest.spyOn(next, 'handle');
      await interceptor.intercept(wsCtx, next);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(rateLimitService.checkByIp).not.toHaveBeenCalled();
    });
  });

  // ── @SkipRateLimit() decorator ────────────────────────────────────────────

  describe('@SkipRateLimit() decorator', () => {
    it('passes through without performing any rate limit check', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const ctx = makeContext({});
      const next = makeNext();
      const spy = jest.spyOn(next, 'handle');
      await interceptor.intercept(ctx, next);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(rateLimitService.checkByIp).not.toHaveBeenCalled();
    });
  });

  // ── All axes allowed ──────────────────────────────────────────────────────

  describe('all axes within limit', () => {
    it('calls next.handle and sets rate-limit response headers', async () => {
      const ctx = makeContext({});
      const next = makeNext();
      const spy = jest.spyOn(next, 'handle');
      await interceptor.intercept(ctx, next);
      expect(spy).toHaveBeenCalledTimes(1);

      const res = (ctx as unknown as { __resMock: { setHeader: jest.Mock } })
        .__resMock;
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Limit',
        expect.any(String),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Remaining',
        expect.any(String),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-RateLimit-Reset',
        expect.any(String),
      );
    });

    it('skips per-user check when no authenticated user is present', async () => {
      await interceptor.intercept(makeContext({}), makeNext());
      expect(rateLimitService.checkByUser).not.toHaveBeenCalled();
    });

    it('runs per-user check when req.user.sub is present', async () => {
      await interceptor.intercept(
        makeContext({ user: { sub: 'user-123' } }),
        makeNext(),
      );
      expect(rateLimitService.checkByUser).toHaveBeenCalledWith('user-123');
    });

    it('skips per-tenant check when no tenant context is present', async () => {
      await interceptor.intercept(makeContext({}), makeNext());
      expect(rateLimitService.checkByTenant).not.toHaveBeenCalled();
    });

    it('runs per-tenant check when req.tenantContext.tenantId is present', async () => {
      await interceptor.intercept(
        makeContext({ tenantContext: { tenantId: 'tenant-42' } }),
        makeNext(),
      );
      expect(rateLimitService.checkByTenant).toHaveBeenCalledWith('tenant-42');
    });
  });

  // ── IP axis exceeded ──────────────────────────────────────────────────────

  describe('IP rate limit exceeded', () => {
    beforeEach(() => {
      rateLimitService.checkByIp.mockResolvedValue(makeExceeded(9999999999));
    });

    it('throws a 429 HttpException', async () => {
      await expect(
        interceptor.intercept(makeContext({}), makeNext()),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('sets Retry-After header before throwing', async () => {
      const ctx = makeContext({});
      const res = (ctx as unknown as { __resMock: { setHeader: jest.Mock } })
        .__resMock;
      await interceptor.intercept(ctx, makeNext()).catch(() => undefined);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Retry-After',
        expect.any(String),
      );
    });

    it('records a legal audit event for IP exceeded', async () => {
      await interceptor
        .intercept(makeContext({}), makeNext())
        .catch(() => undefined);
      expect(legalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.rate_limit.exceeded',
          metadata: expect.objectContaining({ axis: 'ip' }),
        }),
      );
    });
  });

  // ── User axis exceeded ────────────────────────────────────────────────────

  describe('user rate limit exceeded', () => {
    beforeEach(() => {
      rateLimitService.checkByUser.mockResolvedValue(makeExceeded());
    });

    it('throws 429 when per-user limit is exceeded', async () => {
      await expect(
        interceptor.intercept(
          makeContext({ user: { sub: 'user-x' } }),
          makeNext(),
        ),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('records a legal audit event for user exceeded', async () => {
      await interceptor
        .intercept(makeContext({ user: { sub: 'user-x' } }), makeNext())
        .catch(() => undefined);
      expect(legalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.rate_limit.exceeded',
          metadata: expect.objectContaining({ axis: 'user' }),
        }),
      );
    });
  });

  // ── Tenant axis exceeded ──────────────────────────────────────────────────

  describe('tenant rate limit exceeded', () => {
    beforeEach(() => {
      rateLimitService.checkByTenant.mockResolvedValue(makeExceeded());
    });

    it('throws 429 when per-tenant limit is exceeded', async () => {
      await expect(
        interceptor.intercept(
          makeContext({ tenantContext: { tenantId: 'tenant-99' } }),
          makeNext(),
        ),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('records a legal audit event for tenant exceeded', async () => {
      await interceptor
        .intercept(
          makeContext({ tenantContext: { tenantId: 'tenant-99' } }),
          makeNext(),
        )
        .catch(() => undefined);
      expect(legalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.rate_limit.exceeded',
          metadata: expect.objectContaining({ axis: 'tenant' }),
        }),
      );
    });
  });
});
