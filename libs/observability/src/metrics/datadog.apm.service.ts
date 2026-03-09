import { Injectable } from '@nestjs/common';
import { ObservabilityLoggerService } from '../logger/logger.service';

/**
 * Span options that mirror the Datadog tracer `StartSpanOptions` shape.
 * Replace with real types from `dd-trace` when wiring up.
 */
export type TagValue = string | number | boolean;

export interface SpanOptions {
  resource?: string;
  tags?: Record<string, string | number>;
  childOf?: unknown;
}

/**
 * Span handle returned by `startSpan`.
 */
export interface ISpan {
  setTag(key: string, value: TagValue): void;
  finish(): void;
}

/**
 * DatadogApmService — PLACEHOLDER
 *
 * Provides a DI-injectable facade over the Datadog `dd-trace` library.
 * All methods are no-ops until the real tracer is wired in.
 *
 * ── Integration steps (future) ──────────────────────────────────────────────
 * 1. `npm install dd-trace`
 * 2. In each app's main.ts, add AT THE VERY TOP (before other imports):
 *      import tracer from 'dd-trace';
 *      tracer.init({
 *        service: process.env.DATADOG_SERVICE_NAME ?? 'saas-backend',
 *        env: process.env.NODE_ENV,
 *        version: process.env.APP_VERSION,
 *        runtimeMetrics: true,
 *        profiling: true,
 *      });
 * 3. Replace stub implementations in this service with real tracer calls.
 * 4. Set environment variables:
 *      DD_AGENT_HOST=<datadog-agent-host>
 *      DD_TRACE_AGENT_PORT=8126
 *      DATADOG_SERVICE_NAME=saas-api
 *      DATADOG_ENV=production
 * 5. In docker-compose / K8s, run the Datadog Agent as a sidecar or DaemonSet.
 * 6. Dashboards: use "APM > Services" in Datadog UI; import the Node.js
 *    service map template or the NestJS-specific integration.
 *
 * ── Grafana + Datadog ────────────────────────────────────────────────────────
 * Datadog can push metrics to Grafana via the Datadog data source plugin.
 * Configure in Grafana: Settings > Data Sources > Datadog.
 * Recommended dashboards: "Node.js - Overview" and custom SaaS panels
 * measuring p95 latency per tenant, error rate by org, DB query heat maps.
 */
@Injectable()
export class DatadogApmService {
  constructor(private readonly logger: ObservabilityLoggerService) {
    logger.logCtx(
      'DatadogApmService initialised (placeholder — dd-trace not wired)',
      {},
      DatadogApmService.name,
    );
  }

  /**
   * Start a new APM span.
   * Returns a no-op span until dd-trace is integrated.
   *
   * @example
   * const span = this.apm.startSpan('billing.charge', { resource: 'stripe' });
   * try { ... } finally { span.finish(); }
   */
  startSpan(operationName: string, options?: SpanOptions): ISpan {
    this.logger.debugCtx(
      `APM span started (placeholder): ${operationName}`,
      { operationName, resource: options?.resource ?? '' },
      DatadogApmService.name,
    );

    return {
      setTag: (_key: string, _value: TagValue) => {
        /* PLACEHOLDER */
      },
      finish: () => {
        /* PLACEHOLDER */
      },
    };
  }

  /**
   * Add tags to the active (current) span.
   * No-op until dd-trace is integrated.
   */
  setTagsOnActiveSpan(_tags: Record<string, TagValue>): void {
    // PLACEHOLDER — replace with: tracer.scope().active()?.addTags(tags)
  }

  /**
   * Record a custom metric data point.
   * No-op until dd-trace is integrated.
   *
   * @example
   * this.apm.gauge('billing.invoice.amount_usd', 149.99, { tenantId });
   */
  gauge(
    _metricName: string,
    _value: number,
    _tags?: Record<string, string>,
  ): void {
    // PLACEHOLDER — replace with: tracer.dogstatsd.gauge(metricName, value, tags)
  }

  /**
   * Increment a custom counter metric.
   * No-op until dd-trace is integrated.
   */
  increment(_metricName: string, _tags?: Record<string, string>): void {
    // PLACEHOLDER — replace with: tracer.dogstatsd.increment(metricName, 1, tags)
  }
}
