import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IAppLogger } from './interfaces/logger.interface';
import { NestLoggerAdapter } from './adapters/nest-logger.adapter';
import { SentryLogger } from './adapters/sentry.logger';
import { DatadogLogger } from './adapters/datadog.logger';

/**
 * Logger Factory
 *
 * Selects the appropriate logger provider based on environment configuration.
 * Falls back to NestJS Logger if the configured provider is not available.
 */
export class LoggerFactory {
  private static logger = new Logger('LoggerFactory');

  /**
   * Creates a logger instance based on configuration
   */
  static createLogger(configService: ConfigService): IAppLogger {
    const appEnv = configService.get<string>('APP_ENV', 'local');
    const logProvider = configService.get<string>('LOG_PROVIDER', 'nest');
    const logLevel = configService.get<string>('LOG_LEVEL', 'debug');

    this.logger.log(`Creating logger: env=${appEnv}, provider=${logProvider}, level=${logLevel}`);

    // In local/dev, always use Nest Logger
    if (appEnv === 'local' || appEnv === 'dev') {
      this.logger.log('Using NestJS Logger for local/dev environment');
      return new NestLoggerAdapter(logLevel as any);
    }

    // In staging/prod, use configured provider
    try {
      switch (logProvider) {
        case 'sentry': {
          const sentryDsn = configService.get<string>('SENTRY_DSN');
          if (!sentryDsn) {
            this.logger.warn('SENTRY_DSN not configured, falling back to NestJS Logger');
            return new NestLoggerAdapter(logLevel as any);
          }
          this.logger.log('Using Sentry Logger');
          return new SentryLogger(configService);
        }

        case 'datadog': {
          const datadogApiKey = configService.get<string>('DATADOG_API_KEY');
          if (!datadogApiKey) {
            this.logger.warn('DATADOG_API_KEY not configured, falling back to NestJS Logger');
            return new NestLoggerAdapter(logLevel as any);
          }
          this.logger.log('Using Datadog Logger');
          return new DatadogLogger(configService);
        }

        case 'nest':
        default:
          this.logger.log('Using NestJS Logger');
          return new NestLoggerAdapter(logLevel as any);
      }
    } catch (error) {
      this.logger.error(
        `Failed to initialize ${logProvider} logger, falling back to NestJS Logger`,
        error instanceof Error ? error.stack : undefined,
      );
      return new NestLoggerAdapter(logLevel as any);
    }
  }
}
