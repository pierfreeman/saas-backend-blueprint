import { Test, TestingModule } from '@nestjs/testing';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { ObservabilityLoggerService } from '../logger/logger.service';
import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';

function makeHttpContext(options: {
  method?: string;
  url?: string;
  statusCode?: number;
  tenantContext?: { tenantId?: string; role?: string };
}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method: options.method ?? 'GET',
        url: options.url ?? '/test',
        tenantContext: options.tenantContext,
      }),
      getResponse: () => ({ statusCode: options.statusCode ?? 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe('RequestLoggingInterceptor', () => {
  let interceptor: RequestLoggingInterceptor;
  let logger: jest.Mocked<ObservabilityLoggerService>;

  beforeEach(async () => {
    const mockLogger: jest.Mocked<Partial<ObservabilityLoggerService>> = {
      logCtx: jest.fn(),
      warnCtx: jest.fn(),
      errorCtx: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestLoggingInterceptor,
        { provide: ObservabilityLoggerService, useValue: mockLogger },
      ],
    }).compile();

    interceptor = module.get<RequestLoggingInterceptor>(
      RequestLoggingInterceptor,
    );
    logger = module.get(ObservabilityLoggerService);
  });

  afterEach(() => jest.clearAllMocks());

  it('logs a successful request using logCtx', (done) => {
    const ctx = makeHttpContext({
      method: 'GET',
      url: '/api/orgs',
      statusCode: 200,
      tenantContext: { tenantId: 'tid-1', role: 'ADMIN' },
    });

    interceptor.intercept(ctx, { handle: () => of({ data: 'ok' }) }).subscribe({
      complete: () => {
        expect(logger.logCtx).toHaveBeenCalledTimes(1);
        const [message, meta] = logger.logCtx.mock.calls[0];
        expect(message).toContain('GET');
        expect(message).toContain('/api/orgs');
        expect((meta as Record<string, unknown>)['tenantId']).toBe('tid-1');
        expect((meta as Record<string, unknown>)['actorRole']).toBe('ADMIN');
        done();
      },
    });
  });

  it('passes the value through unchanged', (done) => {
    const ctx = makeHttpContext({ url: '/health' });
    interceptor
      .intercept(ctx, { handle: () => of({ status: 'ok' }) })
      .subscribe({
        next: (val) => {
          expect(val).toEqual({ status: 'ok' });
          done();
        },
      });
  });

  it('is transparent for non-HTTP contexts (WebSocket)', (done) => {
    const wsCtx = { getType: () => 'ws' } as unknown as ExecutionContext;
    interceptor.intercept(wsCtx, { handle: () => of('ws-data') }).subscribe({
      next: (val) => {
        expect(val).toBe('ws-data');
        expect(logger.logCtx).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
