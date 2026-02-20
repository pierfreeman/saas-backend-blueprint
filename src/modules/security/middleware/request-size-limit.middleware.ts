import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Response } from 'express';
import { AttackDetectionService } from '../services/attack-detection.service';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityRequest } from '../types/security-request.interface';

@Injectable()
export class RequestSizeLimitMiddleware implements NestMiddleware {
  private readonly maxBodySizeBytes: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly attackDetectionService: AttackDetectionService,
  ) {
    const configuredLimit = this.configService.get<string>('MAX_BODY_SIZE', '2MB');
    this.maxBodySizeBytes = this.parseSizeToBytes(configuredLimit);
  }

  use(request: SecurityRequest, _response: Response, next: NextFunction): void {
    const contentLengthHeader = request.headers['content-length'];
    const contentLength =
      typeof contentLengthHeader === 'string' ? Number.parseInt(contentLengthHeader, 10) : 0;

    if (Number.isFinite(contentLength) && contentLength > this.maxBodySizeBytes) {
      this.attackDetectionService.attachReason(request, 'request_size_limit_exceeded');
      void this.attackDetectionService.registerSuspiciousActivity(
        request,
        'request_size_limit_exceeded',
      );

      throw new SecurityIncidentException(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Request payload too large',
        'request_size_limit',
        {
          contentLength,
          maxBodySizeBytes: this.maxBodySizeBytes,
        },
      );
    }

    next();
  }

  private parseSizeToBytes(value: string): number {
    const normalized = value.trim().toUpperCase();
    const regex = /^(\d+)(B|KB|MB|GB)?$/;
    const match = normalized.match(regex);

    if (!match) {
      return 2 * 1024 * 1024;
    }

    const amount = Number.parseInt(match[1], 10);
    const unit = match[2] || 'B';

    const multiplierMap: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
    };

    return amount * (multiplierMap[unit] || 1);
  }
}
