import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AttackDetectionService } from '../services/attack-detection.service';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityRequest } from '../types/security-request.interface';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly attackDetectionService: AttackDetectionService) {}

  async use(request: SecurityRequest, _response: Response, next: NextFunction): Promise<void> {
    const result = await this.attackDetectionService.checkRateLimit(request);

    if (result.blocked) {
      this.attackDetectionService.attachReason(request, 'rate_limit_exceeded');
      await this.attackDetectionService.registerSuspiciousActivity(request, 'rate_limit_exceeded');

      throw new SecurityIncidentException(
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many requests',
        'rate_limit',
        {
          limit: result.limit,
          count: result.count,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      );
    }

    next();
  }
}
