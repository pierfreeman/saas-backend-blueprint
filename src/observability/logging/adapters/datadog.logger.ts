import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAppLogger } from '../interfaces/logger.interface';
import { RequestContextService } from '../../middleware/request-context.service';

/**
 * Datadog Logger Adapter
 *
 * Formats logs for Datadog ingestion.
 * Also logs to console using NestJS Logger for local visibility.
 *
 * Note: When dd-trace is properly initialized, logs will be automatically
 * sent to Datadog. This adapter ensures proper formatting and enrichment.
 */
export class DatadogLogger implements IAppLogger {
  private readonly nestLogger = new Logger('Datadog');
  private readonly service: string;
  private readonly environment: string;
  private readonly version: string;
  private readonly shouldMaskSensitiveData: boolean;

  constructor(private readonly configService: ConfigService) {
    this.service = configService.get<string>('DATADOG_SERVICE', 'sports-intelligence-backend');
    this.environment = configService.get<string>('DATADOG_ENV', 'unknown');
    this.version = configService.get<string>('DATADOG_VERSION', '1.0.0');
    this.shouldMaskSensitiveData = configService.get<string>('APP_ENV') !== 'local';
  }

  log(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.log(message, context);
    this.sendToDatadog('info', message, context, metadata);
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.nestLogger.error(message, trace, context);
    this.sendToDatadog('error', message, context, {
      ...metadata,
      stackTrace: trace,
    });
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.warn(message, context);
    this.sendToDatadog('warn', message, context, metadata);
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.debug(message, context);
    this.sendToDatadog('debug', message, context, metadata);
  }

  verbose(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.nestLogger.verbose(message, context);
    this.sendToDatadog('debug', message, context, metadata);
  }

  private sendToDatadog(
    level: string,
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const logEntry = this.formatForDatadog(level, message, context, metadata);

    // Output as JSON for Datadog agent or HTTP intake to parse
    console.log(JSON.stringify(logEntry));
  }

  private formatForDatadog(
    level: string,
    message: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): Record<string, unknown> {
    const requestContext = RequestContextService.getContext();

    const logEntry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      env: this.environment,
      version: this.version,
      logger: {
        name: context || 'app',
      },
    };

    // Add request context
    if (requestContext) {
      if (requestContext.requestId) {
        logEntry['dd.trace_id'] = requestContext.requestId;
        logEntry.requestId = requestContext.requestId;
      }
      if (requestContext.userId) {
        logEntry['usr.id'] = requestContext.userId;
      }
      if (requestContext.orgId) {
        logEntry['organization.id'] = requestContext.orgId;
      }
    }

    // Add metadata
    if (metadata) {
      const masked = this.shouldMaskSensitiveData ? this.maskSensitiveData(metadata) : metadata;
      logEntry.metadata = masked;
    }

    return logEntry;
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
