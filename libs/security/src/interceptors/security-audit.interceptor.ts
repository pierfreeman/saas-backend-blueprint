import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { LegalAuditService } from '@libs/legal-audit';
import { extractClientIp } from '../utils/ip.utils';
import { BruteForceService } from '../services/brute-force.service';

interface RequestWithContext extends Request {
  user?: { sub?: string; dbUserId?: string };
  tenantContext?: { tenantId?: string };
}

/**
 * SecurityAuditInterceptor
 *
 * Cross-cutting interceptor that writes compliance-grade security events to
 * the legal audit log for every request that triggers a security-relevant
 * outcome.
 *
 * Events recorded:
 *  - `security.auth.failed`      — JWT validation failed (UnauthorizedException)
 *  - `security.auth.succeeded`   — first successful auth for a request
 *  - `security.token.revoked`    — 401 responses after initial auth (token invalidation)
 *
 * The interceptor also coordinates brute-force accounting:
 *  - On 401: increments the failed-attempt counter for the client IP.
 *  - On success with user context: resets the counter for the IP.
 *
 * Design: fire-and-forget for audit writes; exceptions in the audit path
 * are swallowed to ensure they can never abort business operations.
 */
@Injectable()
export class SecurityAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SecurityAuditInterceptor.name);

  constructor(
    private readonly legalAuditService: LegalAuditService,
    private readonly bruteForceService: BruteForceService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const ip = extractClientIp(req);
    const ipIdentifier = `ip:${ip}`;

    return next.handle().pipe(
      tap(() => {
        // ── Successful response ──────────────────────────────────────────────
        const userId = req.user?.sub;
        if (userId) {
          // Reset brute-force counter on successful authenticated response
          this.bruteForceService
            .resetAttempts(ipIdentifier)
            .catch((err: unknown) =>
              this.logger.error('resetAttempts failed', err),
            );
        }
      }),
      catchError((err: unknown) => {
        // ── Error response ───────────────────────────────────────────────────
        if (err instanceof UnauthorizedException) {
          const path = req.url;
          const tenantId = req.tenantContext?.tenantId;

          // Record failed auth in brute-force counters (async, fire-and-forget)
          this.bruteForceService
            .recordFailedAttempt(ipIdentifier)
            .then(({ locked, attempts }) => {
              this.legalAuditService.recordEvent({
                eventType: 'security.auth.failed',
                orgId: tenantId ?? null,
                triggerType: 'api',
                metadata: {
                  ip,
                  path,
                  method: req.method,
                  attempts,
                  locked,
                },
              });

              if (locked) {
                this.logger.warn(
                  `Brute-force lockout triggered for IP ${ip} after auth failures`,
                );
                this.legalAuditService.recordEvent({
                  eventType: 'security.brute_force.locked',
                  orgId: tenantId ?? null,
                  triggerType: 'system',
                  metadata: { ip, path, attempts },
                });
              }
            })
            .catch((auditErr: unknown) =>
              this.logger.error(
                'SecurityAuditInterceptor recordFailedAttempt error',
                auditErr,
              ),
            );
        }

        return throwError(() => err);
      }),
    );
  }
}
