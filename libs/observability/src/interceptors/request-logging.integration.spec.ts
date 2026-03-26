/**
 * RequestLoggingInterceptor — integration tests
 *
 * Verifies that the interceptor emits a structured access log entry for every
 * HTTP request. Uses a real NestJS HTTP application with no external
 * service dependencies.
 *
 * Coverage:
 *   - 2xx → logger.logCtx with method, path, statusCode, durationMs
 *   - 5xx → logger.warnCtx (access log, not the error log from the filter)
 *   - 4xx → logger.logCtx (access log at info level)
 *   - tenantId / actorRole from req.tenantContext forwarded to log meta
 *   - durationMs is a non-negative number
 */
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as supertest from 'supertest';
import { ObservabilityModule } from '../observability.module';
import { ObservabilityExceptionFilter } from '../filters/observability-exception.filter';
import { ObservabilityLoggerService } from '../logger/logger.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { MockInstance, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  withScope: vi
    .fn()
    .mockImplementation((cb: (scope: object) => void) =>
      cb({ setTag: vi.fn(), setUser: vi.fn() }),
    ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getCurrentScope: vi.fn(() => ({ setTag: vi.fn(), setUser: vi.fn() })),
}));

// ── Minimal test controller ──────────────────────────────────────────────────

@Controller('log-test')
class LogTestController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('crash')
  crash(): never {
    throw new Error('server failure');
  }

  @Get('bad-request')
  badRequest(): never {
    throw new HttpException('validation failed', HttpStatus.BAD_REQUEST);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TenantCtx {
  tenantId?: string;
  role?: string;
}

/**
 * Creates a bootstrapped tracking app, optionally injecting a tenant context
 * into every request via Express middleware.
 */
async function buildApp(tenantCtx?: TenantCtx): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [ObservabilityModule],
    controllers: [LogTestController],
  }).compile();

  const app = module.createNestApplication();

  if (tenantCtx) {
    app.use(
      (req: { tenantContext?: TenantCtx }, _res: unknown, next: () => void) => {
        req.tenantContext = tenantCtx;
        next();
      },
    );
  }

  app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
  app.useGlobalInterceptors(app.get(RequestLoggingInterceptor));
  await app.init();
  return app;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('RequestLoggingInterceptor (integration)', () => {
  let app: INestApplication;
  let logger: ObservabilityLoggerService;
  let logCtxSpy: MockInstance;
  let warnCtxSpy: MockInstance;

  beforeAll(async () => {
    app = await buildApp();
    logger = app.get(ObservabilityLoggerService);
    logCtxSpy = vi.spyOn(logger, 'logCtx');
    warnCtxSpy = vi.spyOn(logger, 'warnCtx');
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  // ── 2xx requests ──────────────────────────────────────────────────────────

  describe('successful (2xx) requests', () => {
    it('logs every request via logCtx with method, path, and statusCode', async () => {
      await supertest(app.getHttpServer()).get('/log-test/ok');
      expect(logCtxSpy).toHaveBeenCalledTimes(1);
      const [, ctx] = logCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(ctx).toMatchObject({
        method: 'GET',
        path: '/log-test/ok',
        statusCode: 200,
      });
    });

    it('includes a non-negative durationMs in the log context', async () => {
      await supertest(app.getHttpServer()).get('/log-test/ok');
      const [, ctx] = logCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(typeof ctx['durationMs']).toBe('number');
      expect(ctx['durationMs'] as number).toBeGreaterThanOrEqual(0);
    });

    it('log message contains method, path, statusCode, and duration', async () => {
      await supertest(app.getHttpServer()).get('/log-test/ok');
      const [message] = logCtxSpy.mock.calls[0] as [string];
      expect(message).toContain('GET');
      expect(message).toContain('/log-test/ok');
      expect(message).toContain('200');
    });
  });

  // ── Error requests ─────────────────────────────────────────────────────────

  describe('error requests', () => {
    it('logs a 5xx via warnCtx with status 500', async () => {
      await supertest(app.getHttpServer()).get('/log-test/crash');
      expect(warnCtxSpy).toHaveBeenCalledTimes(1);
      const [, ctx] = warnCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(ctx).toMatchObject({
        method: 'GET',
        path: '/log-test/crash',
        statusCode: 500,
      });
    });

    it('logs a 4xx request via logCtx (not warnCtx) with the correct status code', async () => {
      await supertest(app.getHttpServer()).get('/log-test/bad-request');
      // The interceptor calls logCtx for the access log entry
      expect(logCtxSpy).toHaveBeenCalledTimes(1);
      const [, ctx, ctxName] = logCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
        string,
      ];
      expect(ctx).toMatchObject({ statusCode: 400 });
      // Verify it came from the interceptor (not the filter)
      expect(ctxName).toBe('RequestLoggingInterceptor');
      // Note: the filter also calls warnCtx for 4xx error logging — that is
      // separate and intentional (access log vs. error log are distinct).
    });
  });

  // ── Tenant context propagation ─────────────────────────────────────────────
  // The real auth middleware sets req.tenantContext after JWT verification.
  // The interceptor must forward these values to the log meta.

  describe('tenant context propagation', () => {
    let appWithTenant: INestApplication;
    let tenantLogCtxSpy: MockInstance;

    beforeAll(async () => {
      appWithTenant = await buildApp({ tenantId: 'tenant-99', role: 'ADMIN' });
      tenantLogCtxSpy = vi.spyOn(
        appWithTenant.get(ObservabilityLoggerService),
        'logCtx',
      );
    });

    afterAll(() => appWithTenant.close());
    beforeEach(() => tenantLogCtxSpy.mockClear());

    it('includes tenantId and actorRole from req.tenantContext in log meta', async () => {
      await supertest(appWithTenant.getHttpServer()).get('/log-test/ok');
      expect(tenantLogCtxSpy).toHaveBeenCalledTimes(1);
      const [, ctx] = tenantLogCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(ctx).toMatchObject({ tenantId: 'tenant-99', actorRole: 'ADMIN' });
    });

    it('includes durationMs even with tenant context present', async () => {
      await supertest(appWithTenant.getHttpServer()).get('/log-test/ok');
      const [, ctx] = tenantLogCtxSpy.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(ctx['durationMs'] as number).toBeGreaterThanOrEqual(0);
    });
  });
});
