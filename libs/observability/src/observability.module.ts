import { Module, Global } from '@nestjs/common';
import { ObservabilityLoggerService } from './logger/logger.service';
import { SentryService } from './sentry/sentry.service';
import { SentryInterceptor } from './sentry/sentry.interceptor';
import { ObservabilityExceptionFilter } from './filters/observability-exception.filter';
import { RequestLoggingInterceptor } from './interceptors/request-logging.interceptor';
import { PrometheusMetricsService } from './metrics/prometheus.metrics.service';
import { DatadogApmService } from './metrics/datadog.apm.service';

/**
 * ObservabilityModule
 *
 * Shared library module providing production-grade observability for all
 * Nx NestJS applications. Import once in each app's root module.
 *
 * Exports
 * ───────
 * - ObservabilityLoggerService   : structured JSON / pretty logger
 * - SentryService                : DI-injectable Sentry SDK wrapper
 * - SentryInterceptor            : captures 5xx in controller pipelines
 * - ObservabilityExceptionFilter : global exception filter with Sentry
 * - RequestLoggingInterceptor    : per-request structured access log
 * - PrometheusMetricsService     : placeholder Prometheus counter/gauge/hist
 * - DatadogApmService            : placeholder Datadog APM tracer
 *
 * Usage — app root module
 * ───────────────────────
 *   @Module({ imports: [ObservabilityModule, ...] })
 *   export class AppModule {}
 *
 * Usage — main.ts
 * ───────────────
 *   // 1. Initialise Sentry BEFORE NestFactory.create (see each app's main.ts)
 *   // 2. After bootstrap:
 *   app.useLogger(app.get(ObservabilityLoggerService));
 *   app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
 *   app.useGlobalInterceptors(
 *     app.get(RequestLoggingInterceptor),
 *     app.get(SentryInterceptor),
 *     // ... other interceptors
 *   );
 *
 * DI scope
 * ────────
 * All providers are singletons (module scope). The logger does NOT use
 * REQUEST scope intentionally — per-request context is passed explicitly
 * via the `logCtx` / `errorCtx` methods as LogContext parameters.
 *
 * No global singletons outside the DI container
 * ─────────────────────────────────────────────
 * Sentry SDK is initialised in main.ts; this module does NOT call
 * `Sentry.init()` to avoid side-effects during library import.
 *
 * @Global() makes all exports available to every module in the consuming
 * app without needing to re-import ObservabilityModule in each feature module.
 */
@Global()
@Module({
  providers: [
    ObservabilityLoggerService,
    SentryService,
    SentryInterceptor,
    ObservabilityExceptionFilter,
    RequestLoggingInterceptor,
    PrometheusMetricsService,
    DatadogApmService,
  ],
  exports: [
    ObservabilityLoggerService,
    SentryService,
    SentryInterceptor,
    ObservabilityExceptionFilter,
    RequestLoggingInterceptor,
    PrometheusMetricsService,
    DatadogApmService,
  ],
})
export class ObservabilityModule {}
