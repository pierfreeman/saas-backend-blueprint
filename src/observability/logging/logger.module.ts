import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerFactory } from './logger.factory';
import { IAppLogger } from './interfaces/logger.interface';
import { SentryExceptionFilter } from '../sentry/sentry.filter';

/**
 * Logger Service Token
 *
 * Use this token to inject the app logger:
 *
 * ```typescript
 * constructor(@Inject('APP_LOGGER') private logger: IAppLogger) {}
 * ```
 */
export const APP_LOGGER = 'APP_LOGGER';

/**
 * Observability Module
 *
 * Provides centralized logging and error tracking with support for:
 * - NestJS Logger (local/dev)
 * - Sentry (staging/prod)
 * - Datadog (staging/prod)
 *
 * The logger is globally available and can be injected using the APP_LOGGER token.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (configService: ConfigService): IAppLogger => {
        return LoggerFactory.createLogger(configService);
      },
      inject: [ConfigService],
    },
    {
      provide: APP_FILTER,
      useClass: SentryExceptionFilter,
    },
  ],
  exports: [APP_LOGGER],
})
export class ObservabilityModule {}
