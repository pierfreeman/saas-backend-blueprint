import { NestLoggerAdapter } from '../../../src/observability/logging/adapters/nest-logger.adapter';
import { RequestContextService } from '../../../src/observability/middleware/request-context.service';

describe('NestLoggerAdapter', () => {
  let adapter: NestLoggerAdapter;

  beforeEach(() => {
    adapter = new NestLoggerAdapter('debug');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should log a message', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      adapter.log('Test message', 'TestContext');

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should enrich log with request context', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
        requestId: 'req-123',
        userId: 'user-456',
        orgId: 'org-789',
        timestamp: new Date(),
      });

      adapter.log('Test message', 'TestContext');

      const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
      const logMessage = lastCall.join(' ');

      expect(logMessage).toContain('req-123');
      expect(logMessage).toContain('user-456');
      expect(logMessage).toContain('org-789');
    });

    it('should include metadata in log', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      adapter.log('Test message', 'TestContext', { key: 'value' });

      const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
      const logMessage = lastCall.join(' ');

      expect(logMessage).toContain('key');
      expect(logMessage).toContain('value');
    });
  });

  describe('error', () => {
    it('should log an error with stack trace', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      adapter.error('Error message', 'Stack trace', 'TestContext');

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should log a warning', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      adapter.warn('Warning message', 'TestContext');

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('debug', () => {
    it('should log a debug message', () => {
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

      adapter.debug('Debug message', 'TestContext');

      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
