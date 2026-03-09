import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Observable } from 'rxjs';
import { SKIP_CSRF_KEY } from '../decorators/security.decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CsrfInterceptor
 *
 * Implements the double-submit cookie pattern for CSRF protection.
 *
 * IMPORTANT: This interceptor is DISABLED by default (CSRF_PROTECTION_ENABLED
 * env var must be set to 'true' to activate it).
 *
 * When to use:
 *  - Cookie-based authentication flows only.
 *  - Auth0 Bearer token authentication is inherently CSRF-safe because
 *    browsers cannot set the Authorization header cross-origin.
 *
 * Pattern:
 *  1. On safe HTTP methods (GET/HEAD/OPTIONS): generate and set a
 *     `__csrf` cookie with a fresh random token.
 *  2. On mutating methods (POST/PUT/PATCH/DELETE): require the client to
 *     echo the cookie value in the `x-csrf-token` request header.
 *     Mismatch results in 403 Forbidden.
 *
 * Skip CSRF validation on specific routes with `@SkipCsrf()`.
 * Always skip on webhook routes (they use HMAC signature validation).
 */
@Injectable()
export class CsrfInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CsrfInterceptor.name);
  private readonly enabled: boolean;
  private readonly cookieName: string;
  private readonly headerName: string;
  private readonly secureCookie: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.enabled =
      this.configService.get<boolean>('security.csrf.enabled') ?? false;
    this.cookieName =
      this.configService.get<string>('security.csrf.cookieName') ?? '__csrf';
    this.headerName =
      this.configService.get<string>('security.csrf.headerName') ??
      'x-csrf-token';
    this.secureCookie =
      this.configService.get<boolean>('security.csrf.secureCookie') ?? false;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    // Check for @SkipCsrf() decorator
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const method = req.method.toUpperCase();

    if (SAFE_METHODS.has(method)) {
      // Issue a fresh CSRF token on safe requests
      const token = randomBytes(32).toString('hex');
      res.cookie(this.cookieName, token, {
        httpOnly: false, // Must be readable by JS to echo in the header
        sameSite: 'strict',
        secure: this.secureCookie,
        path: '/',
      });
      return next.handle();
    }

    // Mutating request — validate the token
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
      this.cookieName
    ];
    const headerToken = req.headers[this.headerName] as string | undefined;

    if (!cookieToken || !headerToken) {
      this.logger.warn(
        `CSRF validation failed: missing token (cookie=${!!cookieToken}, header=${!!headerToken})`,
      );
      throw new ForbiddenException('CSRF token missing');
    }

    // Constant-time comparison to prevent timing-based token guessing
    if (!this.safeCompare(cookieToken, headerToken)) {
      this.logger.warn('CSRF validation failed: token mismatch');
      throw new ForbiddenException('CSRF token invalid');
    }

    return next.handle();
  }

  /**
   * Constant-time string comparison to resist timing-based token guessing.
   * Falls back to false if lengths differ (avoids short-circuit).
   */
  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    // timingSafeEqual throws if buffers differ in length — guarded above
    return timingSafeEqual(aBuf, bBuf);
  }
}
