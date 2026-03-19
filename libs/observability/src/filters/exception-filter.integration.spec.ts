/**
 * ObservabilityExceptionFilter — integration tests
 *
 * Spins up a minimal NestJS HTTP application with ObservabilityModule and a
 * small TestController. Exercises the full request/filter pipeline using
 * supertest — no DB, no Redis, no external services required.
 *
 * Coverage:
 *   - 200 responses pass through unchanged
 *   - 5xx → structured error JSON + logger.errorCtx + sentry.captureException
 *   - 4xx → structured error JSON + logger.warnCtx, NO Sentry capture
 *   - SILENT_PATHS (/favicon.ico etc.) → error JSON, NO logging, NO Sentry
 *   - HTTP error response shape: { statusCode, timestamp, path, method, message }
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
import { ObservabilityExceptionFilter } from './observability-exception.filter';
import { ObservabilityLoggerService } from '../logger/logger.service';
import { SentryService } from '../sentry/sentry.service';

// Prevent actual Sentry SDK network calls during tests
jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  withScope: jest
    .fn()
    .mockImplementation((cb: (scope: object) => void) =>
      cb({ setTag: jest.fn(), setUser: jest.fn(), setExtra: jest.fn() }),
    ),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  getCurrentScope: jest.fn(() => ({ setTag: jest.fn(), setUser: jest.fn() })),
}));

// ── Minimal test controller ──────────────────────────────────────────────────

@Controller('test')
class TestController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('crash')
  crash(): never {
    throw new Error('unexpected server failure');
  }

  @Get('http-error')
  httpError(): never {
    throw new HttpException(
      'client payload invalid',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  @Get('not-found')
  notFound(): never {
    throw new HttpException('resource not found', HttpStatus.NOT_FOUND);
  }
}

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T/;

// ── Suite ────────────────────────────────────────────────────────────────────

describe('ObservabilityExceptionFilter (integration)', () => {
  let app: INestApplication;
  let logger: ObservabilityLoggerService;
  let errorCtxSpy: jest.SpyInstance;
  let warnCtxSpy: jest.SpyInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ObservabilityModule],
      controllers: [TestController],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
    await app.init();

    logger = app.get(ObservabilityLoggerService);

    errorCtxSpy = jest.spyOn(logger, 'errorCtx');
    warnCtxSpy = jest.spyOn(logger, 'warnCtx');
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  // ── Happy path ─────────────────────────────────────────────────────────────

  describe('successful requests', () => {
    it('returns 200 and body unchanged', async () => {
      const res = await supertest(app.getHttpServer()).get('/test/ok');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('does not invoke logger for a 200 response', async () => {
      await supertest(app.getHttpServer()).get('/test/ok');
      expect(errorCtxSpy).not.toHaveBeenCalled();
      expect(warnCtxSpy).not.toHaveBeenCalled();
    });
  });

  // ── Server errors (5xx) ────────────────────────────────────────────────────

  describe('server errors (5xx)', () => {
    it('responds with 500 and a structured error body for an unhandled exception', async () => {
      const res = await supertest(app.getHttpServer()).get('/test/crash');
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        statusCode: 500,
        path: '/test/crash',
        method: 'GET',
        message: 'Internal server error',
      });
      expect(res.body.timestamp).toMatch(ISO_REGEX);
    });

    it('calls logger.errorCtx with the original Error instance and request meta', async () => {
      await supertest(app.getHttpServer()).get('/test/crash');
      expect(errorCtxSpy).toHaveBeenCalledTimes(1);
      const [, err, ctx] = errorCtxSpy.mock.calls[0] as [
        string,
        unknown,
        unknown,
      ];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('unexpected server failure');
      expect(ctx).toMatchObject({
        statusCode: 500,
        method: 'GET',
        path: '/test/crash',
      });
    });

    it("does NOT call sentry.captureException — Sentry capture is SentryInterceptor's responsibility", async () => {
      const sentrySvc = app.get(SentryService);
      const captureSpy = jest.spyOn(sentrySvc, 'captureException');
      await supertest(app.getHttpServer()).get('/test/crash');
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('does not call logger.warnCtx for a 5xx', async () => {
      await supertest(app.getHttpServer()).get('/test/crash');
      expect(warnCtxSpy).not.toHaveBeenCalled();
    });
  });

  // ── Client errors (4xx) ────────────────────────────────────────────────────

  describe('client errors (4xx)', () => {
    it('responds with the correct status and structured body for a 4xx HttpException', async () => {
      const res = await supertest(app.getHttpServer()).get('/test/http-error');
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        statusCode: 422,
        path: '/test/http-error',
        method: 'GET',
        message: 'client payload invalid',
      });
    });

    it('calls logger.warnCtx for a 4xx exception', async () => {
      await supertest(app.getHttpServer()).get('/test/http-error');
      expect(warnCtxSpy).toHaveBeenCalledTimes(1);
      const [, ctx] = warnCtxSpy.mock.calls[0] as [string, unknown];
      expect(ctx).toMatchObject({
        statusCode: 422,
        method: 'GET',
        path: '/test/http-error',
      });
    });

    it('does NOT call sentry.captureException for a 4xx exception', async () => {
      const captureSpy = jest.spyOn(app.get(SentryService), 'captureException');
      await supertest(app.getHttpServer()).get('/test/http-error');
      expect(captureSpy).not.toHaveBeenCalled();
    });

    it('handles a NotFoundException (404) with correct body', async () => {
      const res = await supertest(app.getHttpServer()).get('/test/not-found');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: 'resource not found',
      });
    });
  });

  // ── Silent paths ───────────────────────────────────────────────────────────
  // Browsers request these automatically; logging them would generate noise.

  describe('silent paths', () => {
    const SILENT_PATHS = [
      '/favicon.ico',
      '/favicon.png',
      '/robots.txt',
      '/apple-touch-icon.png',
    ];

    it.each(SILENT_PATHS)(
      'returns 404 for %s but suppresses logging',
      async (path) => {
        const res = await supertest(app.getHttpServer()).get(path);
        // The filter still responds with an error JSON
        expect(res.status).toBe(404);
        // ...but does not write to the logger
        expect(warnCtxSpy).not.toHaveBeenCalled();
        expect(errorCtxSpy).not.toHaveBeenCalled();
      },
    );
  });
});
