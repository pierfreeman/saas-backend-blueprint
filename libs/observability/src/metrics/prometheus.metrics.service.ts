import { Injectable } from '@nestjs/common';
import { ObservabilityLoggerService } from '../logger/logger.service';

/**
 * Counter descriptor — mirrors the prom-client `Counter` shape.
 * Replace this interface with `import { Counter } from 'prom-client'` when
 * you add the real `prom-client` dependency.
 */
export interface ICounter {
  inc(labels?: Record<string, string | number>, value?: number): void;
}

/**
 * Gauge descriptor — mirrors the prom-client `Gauge` shape.
 */
export interface IGauge {
  set(labels: Record<string, string | number>, value: number): void;
  inc(labels?: Record<string, string | number>, value?: number): void;
  dec(labels?: Record<string, string | number>, value?: number): void;
}

/**
 * Histogram descriptor — mirrors the prom-client `Histogram` shape.
 */
export interface IHistogram {
  observe(labels: Record<string, string | number>, value: number): void;
}

/**
 * PrometheusMetricsService — PLACEHOLDER
 *
 * Provides stub counter / gauge / histogram factories that log intent
 * without emitting real metrics. Replace the stubs with real `prom-client`
 * instances when you wire up the Prometheus metrics endpoint.
 *
 * ── Integration steps (future) ──────────────────────────────────────────────
 * 1. `npm install prom-client`
 * 2. Replace stub implementations below with `new Counter(...)` etc.
 * 3. Expose `/metrics` endpoint via `@willsoto/nestjs-prometheus` or a
 *    dedicated MetricsController using `register.metrics()`.
 * 4. Point Prometheus scrape config to `<host>:<port>/metrics`.
 * 5. Import a Grafana dashboard template for NestJS (ID 12156 on grafana.com).
 *
 * ── Grafana dashboard references ─────────────────────────────────────────────
 * - NestJS overview  : https://grafana.com/grafana/dashboards/12156
 * - Node.js process  : https://grafana.com/grafana/dashboards/11159
 * - Custom SaaS board: define panels for http_requests_total, error_rate,
 *   db_query_duration_ms, per-tenant quota usage.
 */
@Injectable()
export class PrometheusMetricsService {
  constructor(private readonly logger: ObservabilityLoggerService) {
    logger.logCtx(
      'PrometheusMetricsService initialised (placeholder — no real metrics emitted)',
      {},
      PrometheusMetricsService.name,
    );
  }

  /**
   * Returns a placeholder counter.
   * @param name  Metric name (e.g. 'http_requests_total')
   * @param help  Human-readable description
   * @param labels  Label name list (e.g. ['method', 'route', 'status'])
   */
  createCounter(name: string, help: string, labels: string[] = []): ICounter {
    this.logger.debugCtx(
      `Counter registered (placeholder): ${name}`,
      { metricName: name, labels: labels.join(',') },
      PrometheusMetricsService.name,
    );

    return {
      inc: (_labels?: Record<string, string | number>, _value?: number) => {
        // PLACEHOLDER — no-op until prom-client is wired in
      },
    };
  }

  /**
   * Returns a placeholder gauge.
   */
  createGauge(name: string, help: string, labels: string[] = []): IGauge {
    this.logger.debugCtx(
      `Gauge registered (placeholder): ${name}`,
      { metricName: name, labels: labels.join(',') },
      PrometheusMetricsService.name,
    );

    return {
      set: (_labels, _value) => {
        /* PLACEHOLDER */
      },
      inc: (_labels?, _value?) => {
        /* PLACEHOLDER */
      },
      dec: (_labels?, _value?) => {
        /* PLACEHOLDER */
      },
    };
  }

  /**
   * Returns a placeholder histogram.
   */
  createHistogram(
    name: string,
    help: string,
    labels: string[] = [],
    buckets?: number[],
  ): IHistogram {
    this.logger.debugCtx(
      `Histogram registered (placeholder): ${name}`,
      { metricName: name, labels: labels.join(',') },
      PrometheusMetricsService.name,
    );

    void buckets; // will be used when prom-client is wired in

    return {
      observe: (_labels, _value) => {
        /* PLACEHOLDER */
      },
    };
  }

  /**
   * Returns the full Prometheus metrics text exposition (empty placeholder).
   * Wire this to a `/metrics` HTTP GET endpoint.
   */
  async getMetrics(): Promise<string> {
    // PLACEHOLDER — replace with `register.metrics()` from prom-client
    return '# Prometheus metrics endpoint not yet configured\n';
  }
}
