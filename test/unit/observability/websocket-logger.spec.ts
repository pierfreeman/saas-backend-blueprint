import { WebSocketLogger } from '../../../src/observability/websocket/websocket.logger';
import { ContextSocket } from '../../../src/observability/websocket/websocket-context.helper';
import { Logger } from '@nestjs/common';

describe('WebSocketLogger', () => {
  let logger: WebSocketLogger;
  let mockSocket: Partial<ContextSocket>;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    logger = new WebSocketLogger('TestGateway', false); // disable Sentry for tests

    mockSocket = {
      id: 'socket-123',
      requestId: 'req-123',
      userId: 'user-456',
      conn: {
        transport: {
          name: 'websocket',
        },
      } as any,
    } as Partial<ContextSocket>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('logConnection', () => {
    it('should log connection event', () => {
      logger.logConnection(mockSocket as ContextSocket, 'user-456');

      expect(logSpy).toHaveBeenCalled();
      const logMessage = logSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).toContain('Client connected');
      expect(logMessage).toContain('socket-123');
      expect(logMessage).toContain('user-456');
    });
  });

  describe('logDisconnection', () => {
    it('should log disconnection event', () => {
      logger.logDisconnection(mockSocket as ContextSocket, 'client disconnect');

      expect(logSpy).toHaveBeenCalled();
      const logMessage = logSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).toContain('Client disconnected');
      expect(logMessage).toContain('socket-123');
    });
  });

  describe('logAuthFailure', () => {
    it('should log authentication failure', () => {
      logger.logAuthFailure(mockSocket as ContextSocket, 'Invalid token');

      expect(warnSpy).toHaveBeenCalled();
      const logMessage = warnSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).toContain('Authentication failed');
      expect(logMessage).toContain('Invalid token');
    });
  });

  describe('logEvent', () => {
    it('should log event with payload', () => {
      logger.logEvent(mockSocket as ContextSocket, 'test:event', { key: 'value' });

      expect(debugSpy).toHaveBeenCalled();
    });

    it('should sanitize sensitive data in payload', () => {
      logger.logEvent(mockSocket as ContextSocket, 'test:event', {
        password: 'secret123',
        username: 'test',
      });

      const logMessage = debugSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).not.toContain('secret123');
      expect(logMessage).toContain('[REDACTED]');
      expect(logMessage).toContain('test');
    });
  });

  describe('logEventError', () => {
    it('should log event error', () => {
      const error = new Error('Test error');

      logger.logEventError(mockSocket as ContextSocket, 'test:event', error);

      expect(errorSpy).toHaveBeenCalled();
      const logMessage = errorSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).toContain('Event error');
      expect(logMessage).toContain('test:event');
      expect(logMessage).toContain('Test error');
    });

    it('should sanitize payload in error log', () => {
      const error = new Error('Test error');

      logger.logEventError(mockSocket as ContextSocket, 'test:event', error, {
        token: 'secret-token',
      });

      const logs = errorSpy.mock.calls.map((call) => call?.join(' ') || '').join(' ');
      expect(logs).not.toContain('secret-token');
      expect(logs).toContain('[REDACTED]');
    });
  });

  describe('logAnomalousDisconnect', () => {
    it('should log anomalous disconnect', () => {
      logger.logAnomalousDisconnect(mockSocket as ContextSocket, 'Timeout exceeded');

      expect(warnSpy).toHaveBeenCalled();
      const logMessage = warnSpy.mock.calls[0]?.join(' ') || '';
      expect(logMessage).toContain('Anomalous disconnect');
      expect(logMessage).toContain('Timeout exceeded');
    });
  });
});
