import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { extractClientIp } from '../utils/ip.utils';
import { LegalAuditService } from '@libs/legal-audit';

/**
 * IpFilterGuard
 *
 * Enforces IP-level access control using allowlist and/or denylist rules.
 *
 * Evaluation order:
 *  1. Denylist check — if the IP is on the denylist, always block (403).
 *  2. Allowlist check — if the allowlist is enabled and the IP is NOT on it,
 *     block (403).
 *  3. Pass through if neither condition triggers.
 *
 * Configuration (via environment variables):
 *  - `IP_ALLOWLIST_ENABLED=true`     — enable allowlist enforcement
 *  - `IP_ALLOWLIST=1.2.3.4,5.6.7.8` — comma-separated allowed IPs
 *  - `IP_DENYLIST_ENABLED=true`      — enable denylist enforcement
 *  - `IP_DENYLIST=9.8.7.6`          — comma-separated blocked IPs
 *
 * All block events are written to the legal audit log.
 *
 * Apply globally or to sensitive admin routes:
 * ```typescript
 * @UseGuards(IpFilterGuard, JwtAuthGuard)
 * @Get('admin/config')
 * async getConfig() { ... }
 * ```
 */
@Injectable()
export class IpFilterGuard implements CanActivate {
  private readonly logger = new Logger(IpFilterGuard.name);

  private readonly allowlistEnabled: boolean;
  private readonly allowedIps: Set<string>;
  private readonly denylistEnabled: boolean;
  private readonly deniedIps: Set<string>;

  constructor(
    private readonly configService: ConfigService,
    private readonly legalAuditService: LegalAuditService,
  ) {
    this.allowlistEnabled =
      this.configService.get<boolean>('security.ipFilter.allowlistEnabled') ??
      false;
    this.allowedIps = new Set(
      this.configService.get<string[]>('security.ipFilter.allowedIps') ?? [],
    );
    this.denylistEnabled =
      this.configService.get<boolean>('security.ipFilter.denylistEnabled') ??
      false;
    this.deniedIps = new Set(
      this.configService.get<string[]>('security.ipFilter.deniedIps') ?? [],
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = extractClientIp(req);

    // 1. Denylist — explicit block takes highest priority
    if (this.denylistEnabled && this.deniedIps.has(ip)) {
      this.logger.warn(`IP filter: denied IP ${ip} blocked`);
      this.legalAuditService.recordEvent({
        eventType: 'security.ip_filter.denied',
        triggerType: 'system',
        metadata: { ip, path: req.url, rule: 'denylist' },
      });
      throw new ForbiddenException('Access denied');
    }

    // 2. Allowlist — only listed IPs may proceed
    if (this.allowlistEnabled && !this.allowedIps.has(ip)) {
      this.logger.warn(`IP filter: IP ${ip} not in allowlist, blocked`);
      this.legalAuditService.recordEvent({
        eventType: 'security.ip_filter.not_allowed',
        triggerType: 'system',
        metadata: { ip, path: req.url, rule: 'allowlist' },
      });
      throw new ForbiddenException('Access denied');
    }

    return true;
  }
}
