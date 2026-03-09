import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { RateLimitService } from '../services/rate-limit.service';
import { extractClientIp } from '../utils/ip.utils';
import { SKIP_RATE_LIMIT_KEY } from '../decorators/security.decorators';
import { LegalAuditService } from '@libs/legal-audit';

interface RequestWithUser extends Request {
  user?: { sub?: string };
  tenantContext?: { tenantId?: string };
}

/**
 * RateLimitInterceptor
 *
 * Distributed Redis-backed rate limiter applied as a global interceptor.
 *
 * Evaluates three independent axes per request:
 *  1. IP address          — coarsest; protects against anonymous floods
 *  2. Authenticated user  — applies once JWT is validated (may be absent)
 *  3. Tenant/organisation — applies when tenant context is present
 *
 * Headers added to all responses:
 *  - X-RateLimit-Limit     — configured maximum for the IP axis
 *  - X-RateLimit-Remaining — requests remaining in current window
 *  - X-RateLimit-Reset     — Unix timestamp when the window resets
 *  - Retry-After           — seconds until reset (only on 429)
 *
 * Skip rate limiting on specific routes with `@SkipRateLimit()`.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly legalAuditService: LegalAuditService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    // WebSocket contexts do not have HTTP request/response
    if (context.getType() !== 'http') {
      return next.handle();
    }

    // Check for @SkipRateLimit() decorator on handler or class
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = extractClientIp(req);

    // ── Axis 1: Per-IP ──────────────────────────────────────────────────────
    const ipResult = await this.rateLimitService.checkByIp(ip);

    res.setHeader(
      'X-RateLimit-Limit',
      String(ipResult.remaining + ipResult.count),
    );
    res.setHeader('X-RateLimit-Remaining', String(ipResult.remaining));
    res.setHeader('X-RateLimit-Reset', String(ipResult.resetAt));

    if (!ipResult.allowed) {
      this.logger.warn(`Rate limit exceeded for IP ${ip}`);
      this.legalAuditService.recordEvent({
        eventType: 'security.rate_limit.exceeded',
        triggerType: 'system',
        metadata: { axis: 'ip', ip, path: req.url },
      });
      this.throwRateLimitError(res, ipResult.resetAt);
    }

    // ── Axis 2: Per-User (only if authenticated) ────────────────────────────
    const userId = req.user?.sub;
    if (userId) {
      const userResult = await this.rateLimitService.checkByUser(userId);
      if (!userResult.allowed) {
        this.logger.warn(`Rate limit exceeded for user ${userId}`);
        this.legalAuditService.recordEvent({
          eventType: 'security.rate_limit.exceeded',
          triggerType: 'system',
          metadata: { axis: 'user', userId, path: req.url },
        });
        this.throwRateLimitError(res, userResult.resetAt);
      }
    }

    // ── Axis 3: Per-Tenant (only if tenant context present) ─────────────────
    const tenantId = req.tenantContext?.tenantId;
    if (tenantId) {
      const tenantResult = await this.rateLimitService.checkByTenant(tenantId);
      if (!tenantResult.allowed) {
        this.logger.warn(`Rate limit exceeded for tenant ${tenantId}`);
        this.legalAuditService.recordEvent({
          eventType: 'security.rate_limit.exceeded',
          triggerType: 'system',
          metadata: {
            axis: 'tenant',
            tenantId,
            path: req.url,
          },
        });
        this.throwRateLimitError(res, tenantResult.resetAt);
      }
    }

    return next.handle();
  }

  private throwRateLimitError(res: Response, resetAt: number): never {
    const now = Math.floor(Date.now() / 1000);
    const retryAfter = Math.max(0, resetAt - now);
    res.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded. Please slow down.',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
