import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttackDetectionService } from '../services/attack-detection.service';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityLoggerService } from '../services/security-logger.service';
import { SecurityRequest } from '../types/security-request.interface';

@Injectable()
export class SuspiciousActivityGuard implements CanActivate {
  private readonly autoThrottleEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly attackDetectionService: AttackDetectionService,
    private readonly securityLoggerService: SecurityLoggerService,
  ) {
    this.autoThrottleEnabled =
      this.configService.get<string>('SECURITY_AUTO_THROTTLE_ENABLED', 'true') === 'true';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SecurityRequest>();

    if (await this.attackDetectionService.isSuspiciouslyBlocked(request)) {
      throw new SecurityIncidentException(
        HttpStatus.TOO_MANY_REQUESTS,
        'Suspicious traffic temporarily throttled',
        'suspicious_auto_throttle',
      );
    }

    if (!this.attackDetectionService.hasMalformedSignals(request)) {
      return true;
    }

    this.attackDetectionService.attachReason(request, 'malformed_request_pattern');
    await this.attackDetectionService.registerSuspiciousActivity(
      request,
      'malformed_request_pattern',
    );

    const identity = this.attackDetectionService.getIdentity(request);
    this.securityLoggerService.logSuspiciousActivity({
      reason: 'malformed_request_pattern',
      endpoint: identity.endpoint,
      method: identity.method,
      ip: identity.ip,
      timestamp: new Date().toISOString(),
      userId: identity.userId,
      orgId: identity.orgId,
    });

    if (this.autoThrottleEnabled) {
      throw new SecurityIncidentException(
        HttpStatus.BAD_REQUEST,
        'Malformed request blocked by security guard',
        'malformed_request_pattern',
      );
    }

    return true;
  }
}
