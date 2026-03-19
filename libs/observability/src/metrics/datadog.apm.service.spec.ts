import { Test, TestingModule } from '@nestjs/testing';
import { DatadogApmService } from './datadog.apm.service';
import { ObservabilityLoggerService } from '../logger/logger.service';

describe('DatadogApmService', () => {
  let service: DatadogApmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DatadogApmService, ObservabilityLoggerService],
    }).compile();

    service = module.get<DatadogApmService>(DatadogApmService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── startSpan ──────────────────────────────────────────────────────────────

  describe('startSpan', () => {
    it('returns a span with setTag and finish methods', () => {
      const span = service.startSpan('billing.charge');
      expect(span).toBeDefined();
      expect(typeof span.setTag).toBe('function');
      expect(typeof span.finish).toBe('function');
    });

    it('creates a span with resource option without throwing', () => {
      const span = service.startSpan('billing.charge', {
        resource: 'stripe',
        tags: { orgId: 'org-1' },
      });
      expect(span).toBeDefined();
    });

    it('span.setTag() executes without throwing (no-op placeholder)', () => {
      const span = service.startSpan('test.operation');
      expect(() => span.setTag('http.status_code', 200)).not.toThrow();
      expect(() => span.setTag('error', true)).not.toThrow();
    });

    it('span.finish() executes without throwing (no-op placeholder)', () => {
      const span = service.startSpan('test.operation');
      expect(() => span.finish()).not.toThrow();
    });
  });

  // ── setTagsOnActiveSpan ────────────────────────────────────────────────────

  describe('setTagsOnActiveSpan', () => {
    it('executes without throwing (no-op placeholder)', () => {
      expect(() =>
        service.setTagsOnActiveSpan({
          'tenant.id': 'org-123',
          'http.status': 200,
          hasError: false,
        }),
      ).not.toThrow();
    });

    it('handles empty tags without throwing', () => {
      expect(() => service.setTagsOnActiveSpan({})).not.toThrow();
    });
  });

  // ── gauge ──────────────────────────────────────────────────────────────────

  describe('gauge', () => {
    it('executes without throwing (no-op placeholder)', () => {
      expect(() =>
        service.gauge('billing.invoice.amount_usd', 149.99, {
          tenantId: 'org-1',
        }),
      ).not.toThrow();
    });

    it('accepts calls without tags', () => {
      expect(() => service.gauge('active_jobs', 5)).not.toThrow();
    });
  });

  // ── increment ──────────────────────────────────────────────────────────────

  describe('increment', () => {
    it('executes without throwing (no-op placeholder)', () => {
      expect(() =>
        service.increment('checkout.sessions.started', {
          plan: 'pro',
        }),
      ).not.toThrow();
    });

    it('accepts calls without tags', () => {
      expect(() => service.increment('webhooks.received')).not.toThrow();
    });
  });
});
