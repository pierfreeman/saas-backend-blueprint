# `@libs/observability`

Production-grade shared observability module for the Nx NestJS monorepo.
Provides structured logging, Sentry error monitoring, and placeholder hooks for
Datadog APM and Prometheus metrics — all DI-compliant and multi-tenant safe.

---

## Contents

| Export                         | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `ObservabilityModule`          | Root NestJS module — import once per app           |
| `ObservabilityLoggerService`   | Structured JSON / pretty logger                    |
| `SentryService`                | DI wrapper for `@sentry/node`                      |
| `SentryInterceptor`            | Captures controller-level 5xx in Sentry            |
| `ObservabilityExceptionFilter` | Global exception filter with Sentry + logging      |
| `RequestLoggingInterceptor`    | Per-request access log with tenant context         |
| `PrometheusMetricsService`     | Placeholder Prometheus counter / gauge / histogram |
| `DatadogApmService`            | Placeholder Datadog APM tracer                     |

---

## Quick start

### 1 — Import the module

```ts
// apps/api/src/app/app.module.ts
import { ObservabilityModule } from '@libs/observability';

@Module({
  imports: [ConfigModule, ObservabilityModule, ...],
})
export class AppModule {}
```

### 2 — Initialise Sentry (top of `main.ts`, before NestFactory)

Sentry's async-context tracking requires it to be the very first import.

```ts
// apps/api/src/main.ts   ← must be at the top
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

// ...other imports
import { NestFactory } from '@nestjs/core';
```

### 3 — Wire into the NestJS app

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set structured logger as NestJS internal logger
  app.useLogger(app.get(ObservabilityLoggerService));

  // Replace AllExceptionsFilter with the observability-aware version
  app.useGlobalFilters(app.get(ObservabilityExceptionFilter));

  // Add observability interceptors first in the chain
  app.useGlobalInterceptors(
    app.get(RequestLoggingInterceptor),
    app.get(SentryInterceptor),
    // ... other interceptors
  );
}
```

---

## Logger usage

### Standard log calls (NestJS Logger-compatible)

```ts
@Injectable()
export class MyService {
  constructor(private readonly logger: ObservabilityLoggerService) {}

  doSomething() {
    this.logger.log('Service started', MyService.name); // INFO, label only
    this.logger.warn('High latency detected', MyService.name);
    this.logger.error('Unexpected failure', stack, MyService.name);
  }
}
```

### Structured context-aware calls (preferred in application code)

These methods accept a `LogContext` object with tenant/request metadata:

```ts
// INFO with tenant context
this.logger.logCtx(
  'Subscription created',
  { tenantId, orgId, actorRole, requestId },
  'BillingService',
);

// ERROR with Error instance
this.logger.errorCtx(
  'Payment charge failed',
  error, // Error instance — stack included in output
  { tenantId, orgId, statusCode: 500 },
  'BillingService',
);

// WARN
this.logger.warnCtx(
  'Rate limit approaching',
  { tenantId, requestId },
  'RateLimitGuard',
);

// DEBUG
this.logger.debugCtx('Cache miss', { tenantId }, 'CacheService');
```

### LogContext fields

```ts
interface LogContext {
  tenantId?: string; // Opaque org/tenant ID
  orgId?: string; // Alias for tenantId
  actorRole?: string; // OWNER | ADMIN | MEMBER | READ_ONLY
  userId?: string; // Opaque DB user ID — never email/name
  requestId?: string; // Per-request trace correlation ID
  method?: string; // HTTP method
  path?: string; // URL path
  statusCode?: number;
  durationMs?: number;
  // Additional fields — must not contain PII
  [key: string]: unknown;
}
```

### Multi-tenant PII safety rule

> **Never put PII (emails, names, addresses) in `LogContext`.**  
> Use only opaque IDs (`tenantId`, `userId`, `orgId`). Callers are responsible.

---

## Log output formats

### Development (pretty — default)

```
2026-01-01T00:00:00.000Z LOG     [BillingService] Subscription created {"tenantId":"tid-x","orgId":"oid-y","actorRole":"OWNER"}
```

### Production (JSON / NDJSON)

Set `NODE_ENV=production` or `LOG_FORMAT=json`:

```json
{
  "timestamp": "2026-01-01T00:00:00.000Z",
  "level": "log",
  "message": "Subscription created",
  "context": "BillingService",
  "tenantId": "tid-x",
  "orgId": "oid-y",
  "actorRole": "OWNER"
}
```

NDJSON lines are consumed directly by CloudWatch Logs Insights, Datadog Logs,
the ELK Logstash jsonfilter, or any structured log aggregator.

---

## Error monitoring (Sentry)

### Automatic — via `ObservabilityExceptionFilter`

All unhandled HTTP exceptions are automatically forwarded to Sentry.
Only 5xx errors are captured; 4xx client errors are not.

Sentry tags attached per event:

- `tenantId` — organisation ID
- `orgId` — same as tenantId (for Sentry filter UX)
- `actorRole` — RBAC role
- `requestId` — trace correlation

### Manual capture

```ts
@Injectable()
export class WorkerService {
  constructor(private readonly sentry: SentryService) {}

  async processJob(tenantId: string) {
    try {
      await this.doWork();
    } catch (err) {
      this.sentry.captureException(err, { tenantId, actorRole: 'SYSTEM' });
      throw err;
    }
  }
}
```

### Uncaught promise rejections (Lambda / Worker)

```ts
// In main.ts of worker apps
bootstrap().catch((error: unknown) => {
  Sentry.captureException(error);
  process.stderr.write(`Fatal: ${String(error)}\n`);
  process.exit(1);
});
```

---

## Metrics (Prometheus — placeholder)

`PrometheusMetricsService` provides no-op stub factories (`createCounter`, `createHistogram`, `createGauge`) that compile and run without errors. Call sites can already wire up metrics without the real `prom-client` dependency.

### Future: enabling real Prometheus

1. `npm install prom-client @willsoto/nestjs-prometheus`
2. Replace stub bodies in `PrometheusMetricsService` with `new Counter(...)` etc.
3. Expose a `/metrics` endpoint and configure a Prometheus scrape job.
4. Enable `PROMETHEUS_ENABLED=true`.

---

## APM (Datadog — placeholder)

`DatadogApmService` provides no-op stub methods (`startSpan`, `setTagsOnActiveSpan`, `finishSpan`). Call sites are already integrated; enabling tracing requires no refactoring.

### Future: enabling real Datadog APM

1. `npm install dd-trace`
2. Add `import tracer from 'dd-trace'; tracer.init({ ... })` at the very top of `main.ts`, before all other imports.
3. Replace stub bodies in `DatadogApmService` with real `tracer.*` calls.
4. Run the Datadog Agent as a sidecar and set `DATADOG_ENABLED=true`.

---

## Environment variables

| Variable                    | Default        | Description                                    |
| --------------------------- | -------------- | ---------------------------------------------- |
| `SENTRY_DSN`                | _(empty)_      | Sentry project DSN URL                         |
| `SENTRY_ENABLED`            | `true`         | Set `false` to disable in staging              |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1`          | 0–1 tracing sample rate                        |
| `LOG_LEVEL`                 | `log`          | `verbose` / `debug` / `log` / `warn` / `error` |
| `LOG_FORMAT`                | auto           | `json` (prod) or `pretty` (dev)                |
| `APP_VERSION`               | `unknown`      | Semver or git SHA for Sentry releases          |
| `PROMETHEUS_ENABLED`        | `false`        | Enable Prometheus stub init logging            |
| `DATADOG_ENABLED`           | `false`        | Enable Datadog stub init logging               |
| `DATADOG_SERVICE_NAME`      | `saas-backend` | Datadog service tag                            |

---

## Testing

All services have full unit tests in `src/tests/`:

```bash
# Run all observability tests
npx nx test observability

# With coverage
npx nx test observability --coverage
```

| Test file                                | Covers                                                        |
| ---------------------------------------- | ------------------------------------------------------------- |
| `logger.service.spec.ts`                 | Pretty/JSON modes, logCtx, errorCtx, PII safety               |
| `sentry.service.spec.ts`                 | captureException, captureMessage, scope tags, PII safety      |
| `sentry.interceptor.spec.ts`             | 5xx capture, 4xx skip, non-HTTP skip, context tagging         |
| `observability-exception.filter.spec.ts` | Error/warn levels, Sentry calls, silent paths, response shape |
| `request-logging.interceptor.spec.ts`    | Request metadata, non-HTTP pass-through                       |

---

## Design decisions

### Why `withScope` instead of `withIsolationScope`?

`Sentry.withScope` forks the current scope for the duration of the callback
(synchronous). For async requests, Sentry v8+ uses automatic async-context
propagation via OpenTelemetry — so scopes don't bleed across concurrent
requests as long as `Sentry.init()` is called before `NestFactory.create()`.

For stronger async isolation in high-concurrency scenarios, replace
`withScope` with `withIsolationScope` in `SentryService.captureException`.

### Why is `ObservabilityLoggerService` a singleton (not REQUEST-scoped)?

Request-scoped providers create a new instance per request, adding GC pressure
at high throughput. Instead, tenant context is passed **explicitly** via the
`logCtx`/`errorCtx` method parameters — keeping the service singleton while
still producing fully structured, per-request log entries.

### Why `@Global()` on `ObservabilityModule`?

Marking the module `@Global()` means any feature module that needs to inject
`ObservabilityLoggerService` or `SentryService` can do so **without** also
importing `ObservabilityModule`. This avoids repetitive imports across 10+
feature modules while keeping a single point of registration in the app root.
