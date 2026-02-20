import { Module, Global } from '@nestjs/common';

/**
 * Sentry Module
 *
 * Provides Sentry integration for error tracking and performance monitoring.
 * The actual initialization happens in main.ts before the app is created.
 *
 * This module exports the filter and interceptor for use in the app.
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class SentryModule {}
