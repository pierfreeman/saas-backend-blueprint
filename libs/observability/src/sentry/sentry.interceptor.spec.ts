import { Test, TestingModule } from '@nestjs/testing';
import { SentryInterceptor } from './sentry.interceptor';
import { SentryService } from './sentry.service';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Observable, of, throwError } from 'rxjs';

function makeCallHandler(obs: Observable<unknown>) {
  return { handle: () => obs };
}

function makeHttpContext(tenantContext?: {
  tenantId?: string;
  userId?: string;
  role?: string;
}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ tenantContext }),
    }),
  } as unknown as ExecutionContext;
}

describe('SentryInterceptor', () => {
  let interceptor: SentryInterceptor;
  let sentryService: jest.Mocked<SentryService>;

  beforeEach(async () => {
    const mockSentryService: jest.Mocked<SentryService> = {
      captureException: jest.fn(),
      captureMessage: jest.fn(),
      withScope: jest.fn(),
    } as unknown as jest.Mocked<SentryService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SentryInterceptor,
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    interceptor = module.get<SentryInterceptor>(SentryInterceptor);
    sentryService = module.get(SentryService);
  });

  afterEach(() => jest.clearAllMocks());

  it('passes through successful responses without calling Sentry', (done) => {
    const ctx = makeHttpContext({ tenantId: 'tid-1' });
    const handler = makeCallHandler(of({ ok: true }));

    interceptor.intercept(ctx, handler).subscribe({
      next: (val) => expect(val).toEqual({ ok: true }),
      complete: () => {
        expect(sentryService.captureException).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('captures a 5xx error to Sentry and re-throws', (done) => {
    const ctx = makeHttpContext({
      tenantId: 'tid-2',
      userId: 'user-1',
      role: 'ADMIN',
    });
    const serverError = new Error('DB exploded');
    const handler = makeCallHandler(throwError(() => serverError));

    interceptor.intercept(ctx, handler).subscribe({
      error: (err: Error) => {
        expect(err).toBe(serverError);
        expect(sentryService.captureException).toHaveBeenCalledTimes(1);
        const [capturedError, context] =
          sentryService.captureException.mock.calls[0];
        expect(capturedError).toBe(serverError);
        expect((context as Record<string, string>)['tenantId']).toBe('tid-2');
        expect((context as Record<string, string>)['userId']).toBe('user-1');
        done();
      },
    });
  });

  it('does NOT capture a 400 (client error) to Sentry', (done) => {
    const ctx = makeHttpContext({ tenantId: 'tid-3' });
    const clientError = new HttpException(
      'Bad request',
      HttpStatus.BAD_REQUEST,
    );
    const handler = makeCallHandler(throwError(() => clientError));

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        expect(sentryService.captureException).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('does NOT capture for non-HTTP contexts', (done) => {
    const wsContext = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    const serverError = new Error('WS error');
    const handler = makeCallHandler(throwError(() => serverError));

    interceptor.intercept(wsContext, handler).subscribe({
      error: () => {
        expect(sentryService.captureException).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('includes actorRole in Sentry context', (done) => {
    const ctx = makeHttpContext({ tenantId: 'tid-4', role: 'OWNER' });
    const handler = makeCallHandler(throwError(() => new Error('boom')));

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const [, context] = sentryService.captureException.mock.calls[0];
        expect((context as Record<string, string>)['actorRole']).toBe('OWNER');
        done();
      },
    });
  });
});
