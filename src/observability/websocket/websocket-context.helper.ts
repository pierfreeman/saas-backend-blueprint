import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { RequestContextService } from '../middleware/request-context.service';

/**
 * WebSocket Context Adapter
 *
 * Extends Socket.IO sockets with request context tracking.
 * Similar to HTTP request context, but for WebSocket connections.
 */
export interface ContextSocket extends Socket {
  requestId?: string;
  userId?: string;
  orgId?: string;
  email?: string;
}

/**
 * WebSocket Context Helper
 *
 * Utilities for managing request context in WebSocket handlers.
 */
export class WebSocketContextHelper {
  /**
   * Initialize context for a WebSocket connection
   */
  static initializeContext(socket: ContextSocket): void {
    if (!socket.requestId) {
      socket.requestId = uuidv4();
    }

    // Set request context for this socket's operations
    RequestContextService.run(
      {
        requestId: socket.requestId,
        userId: socket.userId,
        orgId: socket.orgId,
        timestamp: new Date(),
      },
      () => {},
    );
  }

  /**
   * Run a function within the socket's request context
   */
  static runInContext<T>(socket: ContextSocket, fn: () => T): T {
    return RequestContextService.run(
      {
        requestId: socket.requestId || uuidv4(),
        userId: socket.userId,
        orgId: socket.orgId,
        timestamp: new Date(),
      },
      fn,
    );
  }

  /**
   * Update socket context with user info
   */
  static setUserContext(
    socket: ContextSocket,
    userId: string,
    email?: string,
    orgId?: string,
  ): void {
    socket.userId = userId;
    socket.email = email;
    socket.orgId = orgId;

    // Update global context
    RequestContextService.updateContext({
      userId,
      orgId,
    });
  }

  /**
   * Get context from socket
   */
  static getSocketContext(socket: ContextSocket): {
    requestId?: string;
    userId?: string;
    orgId?: string;
  } {
    return {
      requestId: socket.requestId,
      userId: socket.userId,
      orgId: socket.orgId,
    };
  }
}
