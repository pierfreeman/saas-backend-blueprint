import {
  WebSocketContextHelper,
  ContextSocket,
} from '../../../src/observability/websocket/websocket-context.helper';
import { Socket } from 'socket.io';

describe('WebSocketContextHelper', () => {
  let mockSocket: Partial<ContextSocket>;

  beforeEach(() => {
    mockSocket = {
      id: 'socket-123',
      conn: {
        transport: {
          name: 'websocket',
        },
      } as any,
    } as Partial<ContextSocket>;
  });

  describe('initializeContext', () => {
    it('should generate a request ID', () => {
      WebSocketContextHelper.initializeContext(mockSocket as ContextSocket);

      expect(mockSocket.requestId).toBeDefined();
      expect(mockSocket.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should not override existing request ID', () => {
      mockSocket.requestId = 'existing-req-id';

      WebSocketContextHelper.initializeContext(mockSocket as ContextSocket);

      expect(mockSocket.requestId).toBe('existing-req-id');
    });
  });

  describe('setUserContext', () => {
    it('should set user context on socket', () => {
      WebSocketContextHelper.setUserContext(
        mockSocket as ContextSocket,
        'user-456',
        'user@example.com',
        'org-789',
      );

      expect(mockSocket.userId).toBe('user-456');
      expect(mockSocket.email).toBe('user@example.com');
      expect(mockSocket.orgId).toBe('org-789');
    });

    it('should work without optional parameters', () => {
      WebSocketContextHelper.setUserContext(mockSocket as ContextSocket, 'user-456');

      expect(mockSocket.userId).toBe('user-456');
      expect(mockSocket.email).toBeUndefined();
      expect(mockSocket.orgId).toBeUndefined();
    });
  });

  describe('getSocketContext', () => {
    it('should return socket context', () => {
      mockSocket.requestId = 'req-123';
      mockSocket.userId = 'user-456';
      mockSocket.orgId = 'org-789';

      const context = WebSocketContextHelper.getSocketContext(mockSocket as ContextSocket);

      expect(context).toEqual({
        requestId: 'req-123',
        userId: 'user-456',
        orgId: 'org-789',
      });
    });

    it('should return undefined values for missing context', () => {
      const context = WebSocketContextHelper.getSocketContext(mockSocket as ContextSocket);

      expect(context).toEqual({
        requestId: undefined,
        userId: undefined,
        orgId: undefined,
      });
    });
  });

  describe('runInContext', () => {
    it('should run function in socket context', () => {
      mockSocket.requestId = 'req-123';
      mockSocket.userId = 'user-456';

      const result = WebSocketContextHelper.runInContext(mockSocket as ContextSocket, () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });
  });
});
