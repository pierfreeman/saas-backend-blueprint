import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { extractClientIp } from '../utils/ip.utils';
import { BruteForceService } from '../services/brute-force.service';
import { LegalAuditService } from '@libs/legal-audit';

/**
 * BruteForceGuard
 *
 * Pre-authentication guard that checks whether a client IP is currently
 * locked out due to excessive failed authentication attempts.
 *
 * Pipeline position: before JwtAuthGuard / any auth processing.
 *
 * When a lockout is active:
 *  - Responds 429 Too Many Requests with a Retry-After header
 *  - Records a `security.brute_force.blocked` compliance event
 *
 * Apply to authentication endpoints:
 * ```typescript
 * @UseGuards(BruteForceGuard, JwtAuthGuard)
 * @Post('login')
 * async login(...) { ... }
 * ```
 *
 * Reset on successful auth by calling:
 * ```typescript
 * await this.bruteForceService.resetAttempts(`ip:${ip}`);
 * ```
 */
@Injectable()
export class BruteForceGuard implements CanActivate {
  private readonly logger = new Logger(BruteForceGuard.name);

  constructor(
    private readonly bruteForceService: BruteForceService,
    private readonly legalAuditService: LegalAuditService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = extractClientIp(req);
    const identifier = `ip:${ip}`;

    const state = await this.bruteForceService.getState(identifier);

    if (state.locked) {
      this.logger.warn(
        `Brute-force lockout: blocked request from IP ${ip} (${state.lockoutRemainingSeconds}s remaining)`,
      );

      this.legalAuditService.recordEvent({
        eventType: 'security.brute_force.blocked',
        triggerType: 'system',
        metadata: {
          ip,
          path: req.url,
          method: req.method,
          lockoutRemainingSeconds: state.lockoutRemainingSeconds,
        },
      });

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many failed authentication attempts. Try again later.',
          retryAfter: state.lockoutRemainingSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
