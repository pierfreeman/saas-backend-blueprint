import { Module, Global } from '@nestjs/common';

/**
 * Datadog Module
 *
 * Provides Datadog APM integration for distributed tracing and monitoring.
 * The actual initialization happens in main.ts before anything else is imported.
 *
 * When dd-trace is properly initialized, it automatically instruments:
 * - HTTP requests
 * - Database queries
 * - Redis operations
 * - And many other libraries
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class DatadogModule {}
