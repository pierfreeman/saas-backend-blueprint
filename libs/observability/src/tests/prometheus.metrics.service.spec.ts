import { Test, TestingModule } from '@nestjs/testing';
import { PrometheusMetricsService } from '../metrics/prometheus.metrics.service';
import { ObservabilityLoggerService } from '../logger/logger.service';

describe('PrometheusMetricsService', () => {
  let service: PrometheusMetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrometheusMetricsService, ObservabilityLoggerService],
    }).compile();

    service = module.get<PrometheusMetricsService>(PrometheusMetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── createCounter ──────────────────────────────────────────────────────────

  describe('createCounter', () => {
    it('returns a counter with an inc() method', () => {
      const counter = service.createCounter(
        'http_requests_total',
        'Total HTTP requests',
        ['method', 'status'],
      );
      expect(counter).toBeDefined();
      expect(typeof counter.inc).toBe('function');
    });

    it('inc() executes without throwing (placeholder no-op)', () => {
      const counter = service.createCounter('test_counter', 'A test counter');
      expect(() => counter.inc({ method: 'GET' }, 1)).not.toThrow();
      expect(() => counter.inc()).not.toThrow();
    });

    it('creates a counter without explicit labels', () => {
      const counter = service.createCounter('simple_counter', 'Simple counter');
      expect(counter).toBeDefined();
    });
  });

  // ── createGauge ────────────────────────────────────────────────────────────

  describe('createGauge', () => {
    it('returns a gauge with set/inc/dec methods', () => {
      const gauge = service.createGauge(
        'active_connections',
        'Active WebSocket connections',
        ['tenant'],
      );
      expect(gauge).toBeDefined();
      expect(typeof gauge.set).toBe('function');
      expect(typeof gauge.inc).toBe('function');
      expect(typeof gauge.dec).toBe('function');
    });

    it('set() executes without throwing', () => {
      const gauge = service.createGauge('test_gauge', 'A test gauge');
      expect(() => gauge.set({ tenant: 'org-1' }, 42)).not.toThrow();
    });

    it('inc() executes without throwing', () => {
      const gauge = service.createGauge('test_gauge', 'A test gauge');
      expect(() => gauge.inc({ tenant: 'org-1' }, 1)).not.toThrow();
      expect(() => gauge.inc()).not.toThrow();
    });

    it('dec() executes without throwing', () => {
      const gauge = service.createGauge('test_gauge', 'A test gauge');
      expect(() => gauge.dec({ tenant: 'org-1' }, 1)).not.toThrow();
      expect(() => gauge.dec()).not.toThrow();
    });
  });

  // ── createHistogram ────────────────────────────────────────────────────────

  describe('createHistogram', () => {
    it('returns a histogram with an observe() method', () => {
      const histogram = service.createHistogram(
        'http_request_duration_ms',
        'HTTP request duration in milliseconds',
        ['route', 'method'],
        [10, 50, 100, 500, 1000],
      );
      expect(histogram).toBeDefined();
      expect(typeof histogram.observe).toBe('function');
    });

    it('observe() executes without throwing', () => {
      const histogram = service.createHistogram(
        'db_query_duration_ms',
        'DB query duration',
      );
      expect(() =>
        histogram.observe({ operation: 'findOne' }, 25),
      ).not.toThrow();
    });

    it('creates a histogram without explicit labels or buckets', () => {
      const histogram = service.createHistogram('simple_hist', 'Simple');
      expect(histogram).toBeDefined();
    });
  });

  // ── getMetrics ─────────────────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns a string placeholder response', async () => {
      const result = await service.getMetrics();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
