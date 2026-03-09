import { registerAs } from '@nestjs/config';

/**
 * Observability configuration namespace.
 *
 * All values are read from environment variables — never hardcoded.
 * See `libs/config/src/env.validation.ts` for Joi validation rules.
 *
 * Environment variables:
 * ┌──────────────────────────────┬────────────────────────────────────────────┐
 * │ Variable                     │ Description                                │
 * ├──────────────────────────────┼────────────────────────────────────────────┤
 * │ SENTRY_DSN                   │ Sentry Data Source Name (project DSN URL)  │
 * │ SENTRY_ENABLED               │ 'true' / 'false' (default: 'true' in prod) │
 * │ SENTRY_TRACES_SAMPLE_RATE    │ 0.0–1.0 tracing sample rate (default: 0.1) │
 * │ LOG_LEVEL                    │ verbose/debug/log/warn/error (default: log) │
 * │ LOG_FORMAT                   │ 'json' | 'pretty' (default: by NODE_ENV)   │
 * │ PROMETHEUS_ENABLED           │ 'true' / 'false' (default: 'false')        │
 * │ DATADOG_ENABLED              │ 'true' / 'false' (default: 'false')        │
 * │ DATADOG_SERVICE_NAME         │ Service name tag in Datadog APM            │
 * │ APP_VERSION                  │ Release version tag (semver / git SHA)     │
 * └──────────────────────────────┴────────────────────────────────────────────┘
 */
export default registerAs('observability', () => ({
  sentry: {
    dsn: process.env['SENTRY_DSN'] ?? '',
    enabled: process.env['SENTRY_ENABLED'] !== 'false',
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['APP_VERSION'] ?? 'unknown',
    tracesSampleRate: Number.parseFloat(
      process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1',
    ),
  },
  logging: {
    level: process.env['LOG_LEVEL'] ?? 'log',
    json:
      process.env['LOG_FORMAT'] === 'json' ||
      process.env['NODE_ENV'] === 'production',
  },
  metrics: {
    prometheusEnabled: process.env['PROMETHEUS_ENABLED'] === 'true',
    datadogEnabled: process.env['DATADOG_ENABLED'] === 'true',
    datadogServiceName: process.env['DATADOG_SERVICE_NAME'] ?? 'saas-backend',
  },
}));
