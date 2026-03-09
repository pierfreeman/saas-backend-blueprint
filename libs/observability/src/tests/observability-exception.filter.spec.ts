import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityExceptionFilter } from '../filters/observability-exception.filter';
import { ObservabilityLoggerService } from '../logger/logger.service';
import { SentryService } from '../sentry/sentry.service';

function makeHost(
  overrides: {
    method?: string;
    url?: string;
    tenantContext?: { tenantId?: string; userId?: string; role?: string };
  } = {},
) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({
        method: overrides.method ?? 'GET',
        url: overrides.url ?? '/api/test',
        tenantContext: overrides.tenantContext,
      }),
    }),
    status,
    json,
  };
}

describe('ObservabilityExceptionFilter', () => {
  let filter: ObservabilityExceptionFilter;
  let logger: jest.Mocked<ObservabilityLoggerService>;
  let sentry: jest.Mocked<SentryService>;

  beforeEach(async () => {
    const mockLogger: jest.Mocked<Partial<ObservabilityLoggerService>> = {
      logCtx: jest.fn(),
      errorCtx: jest.fn(),
      warnCtx: jest.fn(),
      debugCtx: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const mockSentry: jest.Mocked<SentryService> = {
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      withScope: jest.fn(),
    } as unknown as jest.Mocked<SentryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ObservabilityExceptionFilter,
        { provide: ObservabilityLoggerService, useValue: mockLogger },
        { provide: SentryService, useValue: mockSentry },
      ],
    }).compile();

    filter = module.get<ObservabilityExceptionFilter>(
      ObservabilityExceptionFilter,
    );
    logger = module.get(ObservabilityLoggerService);
    sentry = module.get(SentryService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 500 for unknown errors', () => {
    const host = makeHost({
      tenantContext: { tenantId: 'tid-1', role: 'ADMIN' },
    });
    filter.catch(new Error('Unexpected'), host as any);

    const [statusCode] = (host.status as jest.Mock).mock.calls[0];
    expect(statusCode).toBe(500);
  });

  it('logs error and calls Sentry for 5xx', () => {
    const host = makeHost({
      tenantContext: { tenantId: 'tid-1', userId: 'user-1', role: 'OWNER' },
    });
    const err = new Error('Internal crash');
    filter.catch(err, host as any);

    expect(logger.errorCtx).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);

    const [capturedError, sentryContext] =
      sentry.captureException.mock.calls[0];
    expect(capturedError).toBe(err);
    expect((sentryContext as Record<string, string>)['tenantId']).toBe('tid-1');
  });

  it('attaches actorRole and tenantId to Sentry context', () => {
    const host = makeHost({
      tenantContext: { tenantId: 'tid-multi', role: 'MEMBER' },
    });
    filter.catch(new Error('server error'), host as any);

    const [, sentryCtx] = sentry.captureException.mock.calls[0];
    expect((sentryCtx as Record<string, string>)['actorRole']).toBe('MEMBER');
    expect((sentryCtx as Record<string, string>)['tenantId']).toBe('tid-multi');
  });

  it('returns correct status code for 400 HttpException', () => {
    const host = makeHost();
    filter.catch(
      new HttpException('Bad request', HttpStatus.BAD_REQUEST),
      host as any,
    );

    const [statusCode] = (host.status as jest.Mock).mock.calls[0];
    expect(statusCode).toBe(400);
  });

  it('warns (not errors) for 4xx and does NOT send to Sentry', () => {
    const host = makeHost({ url: '/api/missing' });
    filter.catch(
      new HttpException('Not found', HttpStatus.NOT_FOUND),
      host as any,
    );

    expect(logger.warnCtx).toHaveBeenCalledTimes(1);
    expect(logger.errorCtx).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('silently suppresses /favicon.ico (no logs, no Sentry)', () => {
    const host = makeHost({ url: '/favicon.ico' });
    filter.catch(new HttpException('Not found', 404), host as any);

    expect(logger.warnCtx).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('returns consistent JSON error shape', () => {
    const host = makeHost({ method: 'POST', url: '/api/resource' });
    filter.catch(
      new HttpException('Conflict', HttpStatus.CONFLICT),
      host as any,
    );

    const jsonArg = (host.json as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(jsonArg['statusCode']).toBe(409);
    expect(jsonArg['path']).toBe('/api/resource');
    expect(jsonArg['method']).toBe('POST');
    expect(typeof jsonArg['timestamp']).toBe('string');
    expect(jsonArg['message']).toBe('Conflict');
  });

  it('does NOT log tenantId without a tenantContext', () => {
    const host = makeHost(); // no tenantContext
    filter.catch(new HttpException('Forbidden', 403), host as any);

    const [, meta] = logger.warnCtx.mock.calls[0];
    expect((meta as Record<string, unknown>)['tenantId']).toBeUndefined();
  });
});
