import { Logger } from '@nestjs/common';
import { ContextSocket, WebSocketContextHelper } from './websocket-context.helper';
import * as Sentry from '@sentry/node';

/**
 * WebSocket Logger
 *
 * Provides structured logging for WebSocket events with automatic context enrichment.
 * Integrates with the observability system (Sentry, Datadog, etc.)
 */
export class WebSocketLogger {
  private readonly logger: Logger;

  constructor(
    private readonly gatewayName: string,
    private readonly enableSentry: boolean = false,
  ) {
    this.logger = new Logger(`WS:${gatewayName}`);
  }

  /**
   * Log connection event
   */
  logConnection(socket: ContextSocket, userId?: string): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    this.logger.log(
      `Client connected: ${socket.id}${userId ? ` (User: ${userId})` : ''}`,
      JSON.stringify({
        event: 'ws:connect',
        socketId: socket.id,
        userId: userId || context.userId,
        requestId: context.requestId,
        transport: socket.conn.transport.name,
      }),
    );

    if (this.enableSentry) {
      Sentry.addBreadcrumb({
        category: 'websocket',
        message: 'Client connected',
        level: 'info',
        data: {
          gateway: this.gatewayName,
          socketId: socket.id,
          userId: userId || context.userId,
        },
      });
    }
  }

  /**
   * Log disconnection event
   */
  logDisconnection(socket: ContextSocket, reason?: string): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    this.logger.log(
      `Client disconnected: ${socket.id}${reason ? ` (${reason})` : ''}`,
      JSON.stringify({
        event: 'ws:disconnect',
        socketId: socket.id,
        userId: context.userId,
        requestId: context.requestId,
        reason,
      }),
    );

    if (this.enableSentry) {
      Sentry.addBreadcrumb({
        category: 'websocket',
        message: 'Client disconnected',
        level: 'info',
        data: {
          gateway: this.gatewayName,
          socketId: socket.id,
          userId: context.userId,
          reason,
        },
      });
    }
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(socket: ContextSocket, reason: string): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    this.logger.warn(
      `Authentication failed: ${socket.id} - ${reason}`,
      JSON.stringify({
        event: 'ws:auth-failure',
        socketId: socket.id,
        requestId: context.requestId,
        reason,
      }),
    );

    if (this.enableSentry) {
      Sentry.captureMessage(`WebSocket authentication failed: ${reason}`, {
        level: 'warning',
        tags: {
          gateway: this.gatewayName,
          socketId: socket.id,
        },
        extra: context,
      });
    }
  }

  /**
   * Log event handling
   */
  logEvent(
    socket: ContextSocket,
    eventName: string,
    payload?: unknown,
    sanitize: boolean = true,
  ): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    const eventData: Record<string, unknown> = {
      event: 'ws:event',
      socketId: socket.id,
      userId: context.userId,
      requestId: context.requestId,
      eventName,
    };

    if (payload) {
      eventData.payload = sanitize ? this.sanitizePayload(payload) : payload;
    }

    this.logger.debug(`Event received: ${eventName}`, JSON.stringify(eventData));
  }

  /**
   * Log event error
   */
  logEventError(socket: ContextSocket, eventName: string, error: Error, payload?: unknown): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    const errorData: Record<string, unknown> = {
      event: 'ws:event-error',
      socketId: socket.id,
      userId: context.userId,
      requestId: context.requestId,
      eventName,
      error: error.message,
    };

    if (payload) {
      errorData.payload = this.sanitizePayload(payload);
    }

    this.logger.error(
      `Event error: ${eventName} - ${error.message}`,
      error.stack,
      JSON.stringify(errorData),
    );

    if (this.enableSentry) {
      Sentry.captureException(error, {
        tags: {
          gateway: this.gatewayName,
          socketId: socket.id,
          eventName,
        },
        extra: {
          ...context,
          payload: this.sanitizePayload(payload),
        },
        level: 'error',
      });
    }
  }

  /**
   * Log anomalous disconnection
   */
  logAnomalousDisconnect(socket: ContextSocket, reason: string): void {
    const context = WebSocketContextHelper.getSocketContext(socket);

    this.logger.warn(
      `Anomalous disconnect: ${socket.id} - ${reason}`,
      JSON.stringify({
        event: 'ws:anomalous-disconnect',
        socketId: socket.id,
        userId: context.userId,
        requestId: context.requestId,
        reason,
      }),
    );

    if (this.enableSentry) {
      Sentry.captureMessage(`Anomalous WebSocket disconnect: ${reason}`, {
        level: 'warning',
        tags: {
          gateway: this.gatewayName,
          socketId: socket.id,
        },
        extra: context,
      });
    }
  }

  /**
   * Sanitize payload to remove sensitive data
   */
  private sanitizePayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization', 'creditCard'];

    const sanitized = { ...(payload as Record<string, unknown>) };

    for (const key in sanitized) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizePayload(sanitized[key]);
      }
    }

    return sanitized;
  }
}
