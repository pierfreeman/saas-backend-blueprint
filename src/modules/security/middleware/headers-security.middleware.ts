import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class HeadersSecurityMiddleware implements NestMiddleware {
  private readonly enabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<string>('SECURITY_HEADERS_ENABLED', 'true') === 'true';
  }

  use(_request: Request, response: Response, next: NextFunction): void {
    if (!this.enabled) {
      next();
      return;
    }

    response.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-XSS-Protection', '1; mode=block');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');

    next();
  }
}
