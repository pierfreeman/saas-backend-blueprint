/**
 * Worker-A bootstrap
 *
 * Sentry MUST be initialised before NestFactory so async-context tracking
 * is active from the very first import.
 */

// ── Sentry initialisation (must be first) ───────────────────────────────────
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? '',
  enabled:
    process.env['SENTRY_ENABLED'] !== 'false' &&
    process.env['NODE_ENV'] !== 'test',
  environment: process.env['NODE_ENV'] ?? 'development',
  release: process.env['APP_VERSION'] ?? 'unknown',
  tracesSampleRate: Number.parseFloat(
    process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1',
  ),
});
// ────────────────────────────────────────────────────────────────────────────

import { NestFactory } from '@nestjs/core';
import { ObservabilityLoggerService } from '@libs/observability';
import { AppModule } from './app.module';

(async () => {
  // Run as a standalone application context (no HTTP server).
  // SQS long-polling is handled by SqsConsumerService which starts on module init.
  const app = await NestFactory.createApplicationContext(AppModule);

  // Route all NestJS internal logs through the structured observability logger.
  app.useLogger(app.get(ObservabilityLoggerService));

  // Ensure onModuleDestroy hooks fire on SIGTERM/SIGINT (Docker stop, K8s pod eviction).
  app.enableShutdownHooks();

  const logger = app.get(ObservabilityLoggerService);
  logger.logCtx(
    'Worker-Compute-A started — polling SQS for events',
    {},
    'Bootstrap',
  );
})().catch((error: unknown) => {
  Sentry.captureException(error);
  process.stderr.write(
    `Worker-Compute-A failed to start: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
