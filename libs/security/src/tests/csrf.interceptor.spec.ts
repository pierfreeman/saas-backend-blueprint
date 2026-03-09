/**
 * CsrfInterceptor — unit tests
 *
 * The interceptor implements the double-submit cookie pattern:
 *  - Safe methods (GET/HEAD/OPTIONS): generate a fresh token cookie.
 *  - Mutating methods: require the cookie token echoed in the request header.
 *  - Always disabled unless `security.csrf.enabled = true`.
 *  - Routes decorated with @SkipCsrf() bypass validation.
 */
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import { CsrfInterceptor } from '../interceptors/csrf.interceptor';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RequestStub {
  method: string;
  cookies?: Record<string, string>;
  headers: Record<string, string>;
}

function makeContext(req: RequestStub, skipCsrf = false): ExecutionContext {
  const cookieMock = jest.fn();
  const res = { cookie: cookieMock };

  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
    __resMock: res,
  } as unknown as ExecutionContext & { __resMock: typeof res };
}

function makeNextHandler(): CallHandler {
  return { handle: () => of('ok') };
}

function makeConfig(enabled = true, secureCookie = false): ConfigService {
  const vals: Record<string, unknown> = {
    'security.csrf.enabled': enabled,
    'security.csrf.cookieName': '__csrf',
    'security.csrf.headerName': 'x-csrf-token',
    'security.csrf.secureCookie': secureCookie,
  };
  return { get: (k: string) => vals[k] } as unknown as ConfigService;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CsrfInterceptor', () => {
  let reflector: jest.Mocked<Reflector>;

  async function buildInterceptor(enabled = true): Promise<CsrfInterceptor> {
    const reflectorMock = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    };
    reflector = reflectorMock as unknown as jest.Mocked<Reflector>;

    const module = await Test.createTestingModule({
      providers: [
        CsrfInterceptor,
        { provide: ConfigService, useValue: makeConfig(enabled) },
        { provide: Reflector, useValue: reflectorMock },
      ],
    }).compile();

    return module.get(CsrfInterceptor);
  }

  afterEach(() => jest.clearAllMocks());

  // ── Disabled ─────────────────────────────────────────────────────────────

  describe('when CSRF protection is disabled (default)', () => {
    it('passes through without checking tokens', async () => {
      const interceptor = await buildInterceptor(false);
      const ctx = makeContext({ method: 'POST', headers: {} });
      const next = makeNextHandler();
      const spy = jest.spyOn(next, 'handle');
      interceptor.intercept(ctx, next).subscribe();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Non-HTTP context ──────────────────────────────────────────────────────

  describe('non-HTTP contexts', () => {
    it('passes through for WebSocket contexts', async () => {
      const interceptor = await buildInterceptor(true);
      const wsCtx = {
        getType: () => 'ws',
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext;
      const next = makeNextHandler();
      const spy = jest.spyOn(next, 'handle');
      interceptor.intercept(wsCtx, next).subscribe();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── @SkipCsrf() decorator ─────────────────────────────────────────────────

  describe('@SkipCsrf() decorator', () => {
    it('passes through when the skip reflector key is set', async () => {
      const interceptor = await buildInterceptor(true);
      reflector.getAllAndOverride.mockReturnValue(true);
      const ctx = makeContext({ method: 'POST', headers: {} });
      const next = makeNextHandler();
      const spy = jest.spyOn(next, 'handle');
      interceptor.intercept(ctx, next).subscribe();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Safe methods — issue cookie ───────────────────────────────────────────

  describe('safe methods (GET / HEAD / OPTIONS)', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'sets the CSRF cookie on %s requests',
      async (method) => {
        const interceptor = await buildInterceptor(true);
        const ctx = makeContext({ method, headers: {} });
        const resMock = (ctx as unknown as { __resMock: { cookie: jest.Mock } })
          .__resMock;
        const next = makeNextHandler();

        await new Promise<void>((resolve) => {
          interceptor.intercept(ctx, next).subscribe({ complete: resolve });
        });

        expect(resMock.cookie).toHaveBeenCalledWith(
          '__csrf',
          expect.stringMatching(/^[0-9a-f]{64}$/),
          expect.objectContaining({
            httpOnly: false,
            sameSite: 'strict',
            path: '/',
          }),
        );
      },
    );
  });

  // ── Mutating methods — validation ─────────────────────────────────────────

  describe('mutating methods (POST / PUT / PATCH / DELETE)', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'throws 403 when no cookie token is present (%s)',
      async (method) => {
        const interceptor = await buildInterceptor(true);
        const ctx = makeContext({ method, cookies: {}, headers: {} });
        expect(() => interceptor.intercept(ctx, makeNextHandler())).toThrow(
          ForbiddenException,
        );
      },
    );

    it('throws 403 when cookie token exists but header token is missing', async () => {
      const interceptor = await buildInterceptor(true);
      const ctx = makeContext({
        method: 'POST',
        cookies: { __csrf: 'abc123' },
        headers: {},
      });
      expect(() => interceptor.intercept(ctx, makeNextHandler())).toThrow(
        ForbiddenException,
      );
    });

    it('throws 403 when cookie and header tokens do not match', async () => {
      const interceptor = await buildInterceptor(true);
      const ctx = makeContext({
        method: 'POST',
        cookies: { __csrf: 'aaaa' },
        headers: { 'x-csrf-token': 'bbbb' },
      });
      expect(() => interceptor.intercept(ctx, makeNextHandler())).toThrow(
        ForbiddenException,
      );
    });

    it('allows the request when cookie and header tokens match exactly', async () => {
      const interceptor = await buildInterceptor(true);
      const token = 'a'.repeat(64);
      const ctx = makeContext({
        method: 'POST',
        cookies: { __csrf: token },
        headers: { 'x-csrf-token': token },
      });
      const next = makeNextHandler();
      const spy = jest.spyOn(next, 'handle');

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, next).subscribe({ complete: resolve });
      });

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('throws 403 when tokens have different lengths (timing-safe comparison)', async () => {
      const interceptor = await buildInterceptor(true);
      const ctx = makeContext({
        method: 'POST',
        cookies: { __csrf: 'short' },
        headers: { 'x-csrf-token': 'a_longer_token_here' },
      });
      expect(() => interceptor.intercept(ctx, makeNextHandler())).toThrow(
        ForbiddenException,
      );
    });
  });
});
