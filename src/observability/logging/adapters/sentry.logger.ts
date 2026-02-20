import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { IAppLogger } from '../interfaces/logger.interface';
import { RequestContextService } from '../../middleware/request-context.service';

/**
 * Sentry Logger Adapter
 *
 * Sends logs to Sentry with proper tagging and context.
 * Also logs to console using NestJS Logger for local visibility.
 */
export class SentryLogger implements IAppLogger {
  private readonly nestLogger = new Logger('Sentry');
  private readonly shouldMaskSensitiveData: boolean;

  constructor(private readonly configService: ConfigService) {
    this.shouldMaskSensitiveData = configService.get<string>('APP_ENV') !== 'local';
  }

  log(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.log(message, context);

    Sentry.addBreadcrumb({
      category: context || 'app',
      message,
      level: 'info',
      data: this.enrichMetadata(metadata),
    });
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.nestLogger.error(message, trace, context);

    const enrichedMetadata = this.enrichMetadata(metadata);

    Sentry.captureException(new Error(message), {
      tags: {
        context: context || 'app',
      },
      extra: {
        ...enrichedMetadata,
        stackTrace: trace,
      },
      level: 'error',
    });
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.warn(message, context);

    Sentry.captureMessage(message, {
      level: 'warning',
      tags: {
        context: context || 'app',
      },
      extra: this.enrichMetadata(metadata),
    });
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.debug(message, context);

    Sentry.addBreadcrumb({
      category: context || 'app',
      message,
      level: 'debug',
      data: this.enrichMetadata(metadata),
    });
  }

  verbose(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.verbose(message, context);

    Sentry.addBreadcrumb({
      category: context || 'app',
      message,
      level: 'debug',
      data: this.enrichMetadata(metadata),
    });
  }

  private enrichMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
    const context = RequestContextService.getContext();
    const enriched: Record<string, unknown> = {};

    if (context) {
      if (context.requestId) enriched.requestId = context.requestId;
      if (context.userId) enriched.userId = context.userId;
      if (context.orgId) enriched.orgId = context.orgId;
    }

    if (metadata) {
      const masked = this.shouldMaskSensitiveData ? this.maskSensitiveData(metadata) : metadata;
      Object.assign(enriched, masked);
    }

    return enriched;
  }

  private maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'apiKey',
      'api_key',
      'authorization',
      'cookie',
      'creditCard',
      'ssn',
    ];

    const masked = { ...data };

    for (const key in masked) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        masked[key] = '[REDACTED]';
      } else if (typeof masked[key] === 'object' && masked[key] !== null) {
        masked[key] = this.maskSensitiveData(masked[key] as Record<string, unknown>);
      }
    }

    return masked;
  }
}
