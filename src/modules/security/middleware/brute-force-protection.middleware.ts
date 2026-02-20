import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { AttackDetectionService } from '../services/attack-detection.service';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityRequest } from '../types/security-request.interface';

@Injectable()
export class BruteForceProtectionMiddleware implements NestMiddleware {
  constructor(private readonly attackDetectionService: AttackDetectionService) {}

  async use(request: SecurityRequest, response: Response, next: NextFunction): Promise<void> {
    const userIdentifier = this.extractLoginIdentifier(request);
    const bruteForceStatus = await this.attackDetectionService.getBruteForceStatus(
      request,
      userIdentifier,
    );

    if (bruteForceStatus.blocked) {
      this.attackDetectionService.attachReason(request, 'brute_force_blocked');
      await this.attackDetectionService.registerSuspiciousActivity(request, 'brute_force_blocked');

      throw new SecurityIncidentException(
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many failed authentication attempts, temporarily blocked',
        'brute_force',
        {
          retryAfterSeconds: bruteForceStatus.retryAfterSeconds,
          identifier: bruteForceStatus.identifier,
        },
      );
    }

    response.on('finish', () => {
      if (response.statusCode >= 400) {
        void this.attackDetectionService.registerAuthFailure(request, userIdentifier);
        return;
      }

      void this.attackDetectionService.clearAuthFailures(request, userIdentifier);
    });

    next();
  }

  private extractLoginIdentifier(request: SecurityRequest): string | undefined {
    const candidate = request.body as Record<string, unknown> | undefined;

    const identifierFields = ['email', 'username', 'user', 'sub'] as const;
    for (const field of identifierFields) {
      const value = candidate?.[field];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim().toLowerCase();
      }
    }

    return undefined;
  }
}
