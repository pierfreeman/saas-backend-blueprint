import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Response } from 'express';
import { SecurityIncidentException } from '../services/security-incident.exception';
import { SecurityRequest } from '../types/security-request.interface';

@Injectable()
export class CsrfProtectionMiddleware implements NestMiddleware {
  private readonly csrfEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.csrfEnabled = this.configService.get<string>('CSRF_PROTECTION_ENABLED', 'true') === 'true';
  }

  use(request: SecurityRequest, _response: Response, next: NextFunction): void {
    if (!this.csrfEnabled || !this.requiresCsrfCheck(request)) {
      next();
      return;
    }

    const cookies = this.parseCookies(request.headers.cookie);
    const csrfCookie = cookies['csrf_token'] || cookies['XSRF-TOKEN'];
    const csrfHeader =
      request.headers['x-csrf-token'] ||
      request.headers['x-xsrf-token'] ||
      request.headers['csrf-token'];

    if (!csrfCookie || typeof csrfHeader !== 'string' || csrfHeader !== csrfCookie) {
      throw new SecurityIncidentException(
        HttpStatus.FORBIDDEN,
        'CSRF validation failed',
        'csrf_validation_failed',
      );
    }

    next();
  }

  private requiresCsrfCheck(request: SecurityRequest): boolean {
    const method = request.method.toUpperCase();
    const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

    if (!stateChangingMethods.includes(method)) {
      return false;
    }

    const authorization = request.headers.authorization || '';
    if (authorization.startsWith('Bearer ')) {
      return false;
    }

    return typeof request.headers.cookie === 'string' && request.headers.cookie.length > 0;
  }

  private parseCookies(cookieHeader?: string): Record<string, string> {
    if (!cookieHeader) {
      return {};
    }

    return cookieHeader.split(';').reduce<Record<string, string>>((accumulator, cookiePart) => {
      const [key, ...valueParts] = cookiePart.trim().split('=');
      if (!key) {
        return accumulator;
      }

      accumulator[key] = decodeURIComponent(valueParts.join('='));
      return accumulator;
    }, {});
  }
}
