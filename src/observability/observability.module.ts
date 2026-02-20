import { Module, Global, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule as LoggerModule } from './logging/logger.module';
import { SentryModule } from './sentry/sentry.module';
import { DatadogModule } from './datadog/datadog.module';
import { RequestContextMiddleware } from './middleware/request-context.middleware';

/**
 * Observability Module
 *
 * Central module for all observability concerns:
 * - Logging (NestJS Logger / Sentry / Datadog)
 * - Error tracking (Sentry)
 * - APM (Datadog)
 * - Request context tracking
 *
 * This module is globally available and automatically sets up:
 * - Request context middleware for all routes
 * - Logger factory with multi-provider support
 * - Sentry exception filter
 * - Performance tracking
 */
@Global()
@Module({
  imports: [ConfigModule, LoggerModule, SentryModule, DatadogModule],
  exports: [LoggerModule],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply request context middleware to all routes
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
