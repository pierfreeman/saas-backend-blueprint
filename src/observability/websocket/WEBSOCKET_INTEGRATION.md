# WebSocket Observability Integration

This guide shows how to integrate observability into your WebSocket Gateways.

## Quick Start

### 1. Import WebSocket Logger

```typescript
import { WebSocketLogger, WebSocketContextHelper, ContextSocket } from '@/observability/websocket';
```

### 2. Update Your Gateway

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WebSocketLogger, WebSocketContextHelper, ContextSocket } from '@/observability/websocket';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  // Replace NestJS Logger with WebSocketLogger
  private readonly wsLogger: WebSocketLogger;

  constructor(
    // ... your dependencies
  ) {
    // Initialize WebSocket Logger
    this.wsLogger = new WebSocketLogger('NotificationsGateway', true); // true = enable Sentry
  }

  afterInit(_server: Server): void {
    this.wsLogger['logger'].log('WebSocket Gateway initialized');
  }

  async handleConnection(client: ContextSocket): Promise<void> {
    try {
      // Initialize context for this connection
      WebSocketContextHelper.initializeContext(client);

      // Extract and verify token
      const token = this.extractToken(client);

      if (!token) {
        this.wsLogger.logAuthFailure(client, 'No token provided');
        client.disconnect();
        return;
      }

      const payload = await this.verifyToken(token);

      if (!payload || !payload.sub) {
        this.wsLogger.logAuthFailure(client, 'Invalid token');
        client.disconnect();
        return;
      }

      // Set user context
      WebSocketContextHelper.setUserContext(client, payload.sub, payload.email, payload.orgId);

      // Log connection
      this.wsLogger.logConnection(client, payload.sub);

      // ... rest of your connection logic
    } catch (error) {
      this.wsLogger.logEventError(client, 'connection', error as Error);
      client.disconnect();
    }
  }

  handleDisconnect(client: ContextSocket): void {
    const reason = client.disconnected ? 'client' : 'server';
    this.wsLogger.logDisconnection(client, reason);
    
    // ... rest of your disconnect logic
  }

  @SubscribeMessage('notification:get-all')
  async handleGetNotifications(
    client: ContextSocket,
    payload: any,
  ): Promise<{ event: string; data: any }> {
    try {
      // Run in socket's context for proper correlation
      return WebSocketContextHelper.runInContext(client, async () => {
        // Log event
        this.wsLogger.logEvent(client, 'notification:get-all', payload);

        // ... your event logic

        return { event: 'notification:list', data: notifications };
      });
    } catch (error) {
      this.wsLogger.logEventError(client, 'notification:get-all', error as Error, payload);
      return { event: 'notification:error', data: { message: 'Failed' } };
    }
  }
}
```

## Features

### Automatic Context Tracking

- **requestId**: Unique identifier for each connection
- **userId**: Extracted from JWT after authentication
- **orgId**: Organization context (if available)
- **email**: User email from JWT

### Structured Logging

All WebSocket events are logged with:
- Event type (connect, disconnect, event, error)
- Socket ID
- User context (userId, orgId, email)
- Request ID for correlation
- Sanitized payloads (sensitive data removed)

### Sentry Integration

When enabled, automatically sends:
- Connection/disconnection events as breadcrumbs
- Authentication failures as warnings
- Event errors as exceptions
- Anomalous disconnects as warnings

### Log Methods

```typescript
// Connection
wsLogger.logConnection(socket, userId);

// Disconnection
wsLogger.logDisconnection(socket, reason);

// Authentication failure
wsLogger.logAuthFailure(socket, 'Invalid token');

// Event received
wsLogger.logEvent(socket, 'event:name', payload);

// Event error
wsLogger.logEventError(socket, 'event:name', error, payload);

// Anomalous disconnect
wsLogger.logAnomalousDisconnect(socket, 'Timeout exceeded');
```

## Best Practices

1. **Always initialize context** in `handleConnection`
2. **Use `runInContext`** for all event handlers
3. **Log all authentication failures** for security auditing
4. **Enable Sentry** in staging/production
5. **Sanitize sensitive payloads** (automatic, but be aware)
6. **Log anomalous disconnects** (timeouts, unexpected errors)

## Integration Checklist

- [ ] Replace `Socket` with `ContextSocket` type
- [ ] Replace `Logger` with `WebSocketLogger`
- [ ] Call `WebSocketContextHelper.initializeContext()` in connection handler
- [ ] Call `WebSocketContextHelper.setUserContext()` after authentication
- [ ] Wrap event handlers with `runInContext()`
- [ ] Add error logging with `logEventError()`
- [ ] Log auth failures with `logAuthFailure()`
- [ ] Test locally with `APP_ENV=local` and `LOG_PROVIDER=nest`
