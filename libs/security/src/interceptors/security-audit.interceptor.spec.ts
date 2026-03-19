/**
 * SecurityAuditInterceptor — unit tests
 *
 * Cross-cutting interceptor that writes compliance-grade security events
 * to the legal audit log:
 *  - Successful authenticated request → resetAttempts (brute-force counter)
 *  - UnauthorizedException → recordFailedAttempt + legal audit event
 *  - On brute-force lockout → additional 'security.brute_force.locked' event
 *  - Non-HTTP contexts → pass through
 *  - Non-401 errors → re-thrown without audit
 */
import {
  CallHandler,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { SecurityAuditInterceptor } from './security-audit.interceptor';
import { BruteForceService } from '../services/brute-force.service';

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
  ip?: string;
  url?: string;
  method?: string;
  user?: { sub?: string; dbUserId?: string };
  tenantContext?: { tenantId?: string };
}

function makeContext(req: RequestStub = {}): ExecutionContext {
  const ip = req.ip ?? '1.2.3.4';
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        url: req.url ?? '/api/resource',
        method: req.method ?? 'POST',
        user: req.user,
        tenantContext: req.tenantContext,
      }),
    }),
  } as unknown as ExecutionContext;
}

function nextReturning(value: unknown = 'ok'): CallHandler {
  return { handle: () => of(value) };
}

function nextThrowing(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SecurityAuditInterceptor', () => {
  let interceptor: SecurityAuditInterceptor;
  let bruteForceService: jest.Mocked<BruteForceService>;
  let legalAuditService: { recordEvent: jest.Mock };

  beforeEach(async () => {
    const bfs = {
      resetAttempts: jest.fn().mockResolvedValue(undefined),
      recordFailedAttempt: jest
        .fn()
        .mockResolvedValue({
          locked: false,
          attempts: 1,
          lockoutRemainingSeconds: 0,
        }),
      isLocked: jest.fn().mockResolvedValue(false),
      getState: jest.fn(),
    };
    const las = new LegalAuditService();

    const module = await Test.createTestingModule({
      providers: [
        SecurityAuditInterceptor,
        { provide: BruteForceService, useValue: bfs },
        { provide: LegalAuditService, useValue: las },
      ],
    }).compile();

    interceptor = module.get(SecurityAuditInterceptor);
    bruteForceService =
      module.get<jest.Mocked<BruteForceService>>(BruteForceService);
    legalAuditService = module.get<{ recordEvent: jest.Mock }>(
      LegalAuditService,
    );
  });

  afterEach(() => jest.clearAllMocks());

  // ── Non-HTTP context ──────────────────────────────────────────────────────

  describe('non-HTTP contexts', () => {
    it('passes through without any side effects', () => {
      const wsCtx = {
        getType: () => 'ws',
        switchToHttp: () => ({}),
      } as unknown as ExecutionContext;
      const next = nextReturning();
      const spy = jest.spyOn(next, 'handle');
      interceptor.intercept(wsCtx, next).subscribe();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(bruteForceService.resetAttempts).not.toHaveBeenCalled();
    });
  });

  // ── Successful authenticated requests ─────────────────────────────────────

  describe('successful authenticated response', () => {
    it('calls resetAttempts with the IP identifier on success with user', async () => {
      const ctx = makeContext({ user: { sub: 'user-1' } });
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextReturning())
          .subscribe({ complete: resolve });
      });
      // Allow microtasks to flush (fire-and-forget resetAttempts is async)
      await Promise.resolve();
      expect(bruteForceService.resetAttempts).toHaveBeenCalledWith(
        'ip:1.2.3.4',
      );
    });

    it('does NOT call resetAttempts when no authenticated user', async () => {
      const ctx = makeContext({ user: undefined });
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextReturning())
          .subscribe({ complete: resolve });
      });
      await Promise.resolve();
      expect(bruteForceService.resetAttempts).not.toHaveBeenCalled();
    });
  });

  // ── UnauthorizedException ─────────────────────────────────────────────────

  describe('UnauthorizedException handling', () => {
    it('calls recordFailedAttempt with the IP identifier', async () => {
      const ctx = makeContext({});
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new UnauthorizedException()))
          .subscribe({ error: () => resolve() });
      });
      // Fire-and-forget — allow async chain to flush
      await Promise.resolve();
      expect(bruteForceService.recordFailedAttempt).toHaveBeenCalledWith(
        'ip:1.2.3.4',
      );
    });

    it('records a security.auth.failed legal audit event', async () => {
      const ctx = makeContext({ tenantContext: { tenantId: 'tenant-1' } });
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new UnauthorizedException()))
          .subscribe({ error: () => resolve() });
      });
      // Flush the async promise chain
      await new Promise((r) => setTimeout(r, 10));
      expect(legalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.auth.failed',
          triggerType: 'api',
          metadata: expect.objectContaining({ ip: '1.2.3.4' }),
        }),
      );
    });

    it('records a brute-force lockout event when locked=true is returned', async () => {
      bruteForceService.recordFailedAttempt.mockResolvedValue({
        locked: true,
        attempts: 5,
        lockoutRemainingSeconds: 900,
      });

      const ctx = makeContext({ tenantContext: { tenantId: 'tenant-2' } });
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new UnauthorizedException()))
          .subscribe({ error: () => resolve() });
      });
      await new Promise((r) => setTimeout(r, 10));

      const calls = legalAuditService.recordEvent.mock.calls.map(
        (c) => (c[0] as { eventType: string }).eventType,
      );
      expect(calls).toContain('security.brute_force.locked');
    });

    it('re-throws the UnauthorizedException so the response is a 401', async () => {
      let caughtErr: unknown;
      const ctx = makeContext({});
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new UnauthorizedException()))
          .subscribe({
            error: (e) => {
              caughtErr = e;
              resolve();
            },
          });
      });
      expect(caughtErr).toBeInstanceOf(UnauthorizedException);
    });
  });

  // ── Non-401 errors ────────────────────────────────────────────────────────

  describe('non-401 errors', () => {
    it('re-throws non-UnauthorizedException without any audit side effects', async () => {
      let caughtErr: unknown;
      const ctx = makeContext({});
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new ForbiddenException()))
          .subscribe({
            error: (e) => {
              caughtErr = e;
              resolve();
            },
          });
      });
      await Promise.resolve();
      expect(caughtErr).toBeInstanceOf(ForbiddenException);
      expect(bruteForceService.recordFailedAttempt).not.toHaveBeenCalled();
      expect(legalAuditService.recordEvent).not.toHaveBeenCalled();
    });
  });

  // ── Fail-safe (audit errors must not abort business flow) ─────────────────

  describe('fault tolerance', () => {
    it('swallows brute-force errors and still re-throws the original UnauthorizedException', async () => {
      bruteForceService.recordFailedAttempt.mockRejectedValue(
        new Error('Redis down'),
      );
      let caughtErr: unknown;
      const ctx = makeContext({});
      await new Promise<void>((resolve) => {
        interceptor
          .intercept(ctx, nextThrowing(new UnauthorizedException()))
          .subscribe({
            error: (e) => {
              caughtErr = e;
              resolve();
            },
          });
      });
      expect(caughtErr).toBeInstanceOf(UnauthorizedException);
    });
  });
});
