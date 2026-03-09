// Module
export * from './observability.module';

// Logger
export * from './logger/logger.interfaces';
export * from './logger/logger.service';

// Sentry
export * from './sentry/sentry.service';
export * from './sentry/sentry.interceptor';

// Exception filter
export * from './filters/observability-exception.filter';

// Interceptors
export * from './interceptors/request-logging.interceptor';

// Metrics placeholders
export * from './metrics/prometheus.metrics.service';
export * from './metrics/datadog.apm.service';

// Config factory (for registration in ConfigModule)
export { default as observabilityConfig } from './config/observability.config';
