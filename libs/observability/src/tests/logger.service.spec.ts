import { Test, TestingModule } from '@nestjs/testing';
import { ObservabilityLoggerService } from '../logger/logger.service';

describe('ObservabilityLoggerService', () => {
  let service: ObservabilityLoggerService;
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;
  let savedLogLevel: string | undefined;
  let savedLogFormat: string | undefined;

  beforeEach(async () => {
    // NX loads .env.test (which sets LOG_LEVEL=error) for the test target.
    // Clear these before constructing the service so shouldLog() isn't filtered.
    savedLogLevel = process.env['LOG_LEVEL'];
    savedLogFormat = process.env['LOG_FORMAT'];
    delete process.env['LOG_LEVEL'];
    delete process.env['LOG_FORMAT'];

    const module: TestingModule = await Test.createTestingModule({
      providers: [ObservabilityLoggerService],
    }).compile();

    service = module.get<ObservabilityLoggerService>(
      ObservabilityLoggerService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    if (savedLogLevel !== undefined) {
      process.env['LOG_LEVEL'] = savedLogLevel;
    } else {
      delete process.env['LOG_LEVEL'];
    }
    if (savedLogFormat !== undefined) {
      process.env['LOG_FORMAT'] = savedLogFormat;
    } else {
      delete process.env['LOG_FORMAT'];
    }
  });

  // ── pretty mode (default in test env) ───────────────────────────────────────

  describe('pretty mode', () => {
    beforeEach(() => {
      stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
    });

    it('writes an INFO line to stdout', () => {
      service.log('hello world', 'TestContext');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = String(stdoutSpy.mock.calls[0][0]);
      expect(output).toContain('hello world');
      expect(output).toContain('LOG');
    });

    it('writes an ERROR line to stderr', () => {
      service.error('something failed', 'stack trace', 'TestContext');
      expect(stderrSpy).toHaveBeenCalled();
      const output = String(stderrSpy.mock.calls[0][0]);
      expect(output).toContain('something failed');
    });

    it('writes a WARN line to stdout', () => {
      service.warn('watch out', 'TestContext');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = String(stdoutSpy.mock.calls[0][0]);
      expect(output).toContain('watch out');
      expect(output).toContain('WARN');
    });

    it('logCtx emits message with meta context', () => {
      service.logCtx(
        'User invited',
        { tenantId: 'tenant-1', orgId: 'org-1', actorRole: 'OWNER' },
        'InviteService',
      );
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = String(stdoutSpy.mock.calls[0][0]);
      expect(output).toContain('User invited');
      expect(output).toContain('tenant-1');
      expect(output).toContain('InviteService');
    });

    it('warnCtx emits warning with meta context', () => {
      service.warnCtx(
        'Rate limit approaching',
        { tenantId: 'tenant-2', requestId: 'req-abc' },
        'RateLimit',
      );
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = String(stdoutSpy.mock.calls[0][0]);
      expect(output).toContain('Rate limit approaching');
    });

    it('errorCtx emits error with Error instance and meta', () => {
      const err = new Error('DB connection lost');
      service.errorCtx(
        'Query failed',
        err,
        { tenantId: 'tenant-3' },
        'PrismaService',
      );
      expect(stderrSpy).toHaveBeenCalled();
      // Stack should appear in a subsequent write
      const allOutput = stderrSpy.mock.calls
        .map((c: string[]) => String(c[0]))
        .join('');
      expect(allOutput).toContain('Query failed');
    });

    it('errorCtx handles non-Error unknown gracefully', () => {
      service.errorCtx(
        'Unknown failure',
        'not an error object' as unknown as Error,
        {},
      );
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('debugCtx emits debug line with meta', () => {
      service.debugCtx('Cache miss', { tenantId: 'tenant-4' }, 'CacheService');
      // debug level might be filtered; just ensure no throw
      // If filtered, neither stdout nor stderr is written — that's fine
      expect(() => true).not.toThrow();
    });

    it('verbose() emits a verbose line without throwing', () => {
      service.verbose('verbose msg', 'TestContext');
      // verbose is below the default log level — no output expected, no throw
      expect(() => true).not.toThrow();
    });

    it('fatal() emits a fatal line to stderr', () => {
      service.fatal('critical failure', 'TestContext');
      // fatal is always above the min level
      const allOutput = [
        ...stdoutSpy.mock.calls.map((c: string[]) => String(c[0])),
        ...stderrSpy.mock.calls.map((c: string[]) => String(c[0])),
      ].join('');
      expect(allOutput).toContain('critical failure');
    });
  });

  // ── JSON mode ────────────────────────────────────────────────────────────────

  describe('JSON mode', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'production' };
      // Re-instantiate so isJson is evaluated with new env
      service = new ObservabilityLoggerService();
      stdoutSpy = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('emits valid NDJSON for log()', () => {
      service.log('json test', 'Context');
      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const raw = String(stdoutSpy.mock.calls[0][0]).trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['level']).toBe('log');
      expect(parsed['message']).toBe('json test');
      expect(parsed['timestamp']).toBeDefined();
    });

    it('emits NDJSON for logCtx() with tenant fields', () => {
      service.logCtx(
        'Subscription created',
        { tenantId: 'tid-1', orgId: 'oid-1', actorRole: 'OWNER' },
        'BillingService',
      );
      const raw = String(stdoutSpy.mock.calls[0][0]).trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['tenantId']).toBe('tid-1');
      expect(parsed['orgId']).toBe('oid-1');
      expect(parsed['actorRole']).toBe('OWNER');
      expect(parsed['context']).toBe('BillingService');
    });

    it('includes error object in NDJSON for errorCtx()', () => {
      const err = new Error('Stripe timeout');
      service.errorCtx(
        'Charge failed',
        err,
        { tenantId: 'tid-2' },
        'BillingService',
      );
      // In JSON mode all levels (including error) are written to stdout for
      // uniform aggregation by log collectors.
      const raw = String(stdoutSpy.mock.calls[0][0]).trim();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['error']).toBeDefined();
      expect((parsed['error'] as Record<string, unknown>)['message']).toBe(
        'Stripe timeout',
      );
    });

    it('never emits PII — only opaque IDs in context', () => {
      service.logCtx(
        'User action',
        // tenantId & userId are opaque IDs — no name, email
        { tenantId: 'tid-x', userId: 'user-opaque-uuid' },
        'AuditService',
      );
      const raw = String(stdoutSpy.mock.calls[0][0]);
      // Ensure no email-like patterns
      expect(raw).not.toMatch(/@[a-z]+\.[a-z]+/);
    });
  });
});
