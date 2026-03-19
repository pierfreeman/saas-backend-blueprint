/**
 * SentryInterceptor — integration tests (tenant context + 4xx skip)
 *
 * Verifies that the SentryInterceptor correctly:
 *   1. Calls sentry.captureException for 5xx with the original Error
 *   2. Forwards tenantId, userId, and actorRole from req.tenantContext
 *   3. Skips Sentry capture for 4xx HttpExceptions (client errors)
 *   4. Produces isolated capture calls per concurrent request (no bleeding)
 *
 * Uses a real NestJS HTTP server (TestingModule + supertest) with @sentry/node
 * mocked to avoid network calls.
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
import { SentryInterceptor } from './sentry.interceptor';
import { SentryService } from './sentry.service';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  withScope: jest
    .fn()
    .mockImplementation((cb: (scope: object) => void) =>
      cb({ setTag: jest.fn(), setUser: jest.fn() }),
    ),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  getCurrentScope: jest.fn(() => ({ setTag: jest.fn(), setUser: jest.fn() })),
}));

// ── Minimal test controller ──────────────────────────────────────────────────

@Controller('sentry-test')
class SentryTestController {
  @Get('crash')
  crash(): never {
    throw new Error('5xx error for sentry');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }

  @Get('bad-request')
  badRequest(): never {
    throw new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface TenantCtx {
  tenantId?: string;
  userId?: string;
  role?: string;
}

/** Builds an isolated NestJS test app with optional per-request tenant context. */
async function buildApp(tenantCtx?: TenantCtx): Promise<INestApplication> {
  const module = await Test.createTestingModule({
    imports: [ObservabilityModule],
    controllers: [SentryTestController],
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

  // Interceptor runs first; NestJS built-in filter formats the error response.
  // ObservabilityExceptionFilter is intentionally not registered here so that
  // captureException is only called once (by the interceptor, not also by the filter).
  app.useGlobalInterceptors(app.get(SentryInterceptor));
  await app.init();
  return app;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('SentryInterceptor (integration)', () => {
  // ── 5xx capture with tenant context ────────────────────────────────────────

  describe('server errors (5xx) — capture and context forwarding', () => {
    let app: INestApplication;
    let captureExceptionSpy: jest.SpyInstance;

    beforeAll(async () => {
      app = await buildApp({
        tenantId: 'tenant-42',
        userId: 'user-7',
        role: 'OWNER',
      });
      captureExceptionSpy = jest.spyOn(
        app.get(SentryService),
        'captureException',
      );
    });

    afterAll(() => app.close());
    beforeEach(() => jest.clearAllMocks());

    it('calls sentry.captureException once for a 5xx with the thrown Error', async () => {
      await supertest(app.getHttpServer()).get('/sentry-test/crash');
      expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
      const [err] = captureExceptionSpy.mock.calls[0] as [unknown];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('5xx error for sentry');
    });

    it('passes tenantId, orgId, userId, and actorRole to captureException', async () => {
      await supertest(app.getHttpServer()).get('/sentry-test/crash');
      const [, ctx] = captureExceptionSpy.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(ctx).toMatchObject({
        tenantId: 'tenant-42',
        orgId: 'tenant-42',
        userId: 'user-7',
        actorRole: 'OWNER',
      });
    });

    it('responds with HTTP 500 while still forwarding the exception to Sentry', async () => {
      const res = await supertest(app.getHttpServer()).get(
        '/sentry-test/crash',
      );
      // Interceptor re-throws so the filter can still format the response
      expect(res.status).toBe(500);
      expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── 4xx skip ────────────────────────────────────────────────────────────────

  describe('client errors (4xx) — no Sentry capture', () => {
    let app: INestApplication;
    let captureExceptionSpy: jest.SpyInstance;

    beforeAll(async () => {
      app = await buildApp();
      captureExceptionSpy = jest.spyOn(
        app.get(SentryService),
        'captureException',
      );
    });

    afterAll(() => app.close());
    beforeEach(() => jest.clearAllMocks());

    it('does NOT call sentry.captureException for a 403 Forbidden', async () => {
      await supertest(app.getHttpServer()).get('/sentry-test/forbidden');
      expect(captureExceptionSpy).not.toHaveBeenCalled();
    });

    it('does NOT call sentry.captureException for a 400 Bad Request', async () => {
      await supertest(app.getHttpServer()).get('/sentry-test/bad-request');
      expect(captureExceptionSpy).not.toHaveBeenCalled();
    });
  });

  // ── Scope isolation across tenants ────────────────────────────────────────
  // Two separate DI containers (one per tenant) verify the interceptor reads
  // tenantContext from the request, not from module-level state.

  describe('multi-tenant isolation', () => {
    it('captures each tenant context independently in parallel requests', async () => {
      const [appAlpha, appBeta] = await Promise.all([
        buildApp({ tenantId: 'alpha', userId: 'u1', role: 'ADMIN' }),
        buildApp({ tenantId: 'beta', userId: 'u2', role: 'MEMBER' }),
      ]);

      const spyAlpha = jest.spyOn(
        appAlpha.get(SentryService),
        'captureException',
      );
      const spyBeta = jest.spyOn(
        appBeta.get(SentryService),
        'captureException',
      );

      await Promise.all([
        supertest(appAlpha.getHttpServer()).get('/sentry-test/crash'),
        supertest(appBeta.getHttpServer()).get('/sentry-test/crash'),
      ]);

      const [, ctxAlpha] = spyAlpha.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      const [, ctxBeta] = spyBeta.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];

      expect(ctxAlpha).toMatchObject({ tenantId: 'alpha', actorRole: 'ADMIN' });
      expect(ctxBeta).toMatchObject({ tenantId: 'beta', actorRole: 'MEMBER' });

      // Verify no cross-contamination
      expect(ctxAlpha['tenantId']).not.toBe(ctxBeta['tenantId']);

      await Promise.all([appAlpha.close(), appBeta.close()]);
    });

    it('omits Sentry context fields when req.tenantContext is not set', async () => {
      const appNoCtx = await buildApp(); // no tenantCtx middleware
      const spy = jest.spyOn(appNoCtx.get(SentryService), 'captureException');

      await supertest(appNoCtx.getHttpServer()).get('/sentry-test/crash');

      const [, ctx] = spy.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(ctx).toMatchObject({
        tenantId: undefined,
        userId: undefined,
        actorRole: undefined,
      });

      await appNoCtx.close();
    });
  });
});
