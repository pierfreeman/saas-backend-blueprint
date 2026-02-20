# Observability Module

Production-grade application logging and error tracking for NestJS backend.

## 🎯 Features

- **Multi-Provider Support**: NestJS Logger (dev) / Sentry / Datadog (staging/prod)
- **Request Context Tracking**: Automatic correlation of logs via requestId, userId, orgId
- **Zero Breaking Changes**: Drop-in replacement for existing logging
- **WebSocket Support**: Full observability for Socket.IO gateways
- **Sensitive Data Masking**: Automatic redaction of passwords, tokens, etc.
- **Performance Tracing**: Distributed tracing with Sentry and Datadog
- **Type-Safe**: Full TypeScript support

## 📦 Architecture

```
observability/
├── logging/
│   ├── interfaces/
│   │   └── logger.interface.ts       # IAppLogger interface
│   ├── adapters/
│   │   ├── nest-logger.adapter.ts    # NestJS Logger wrapper
│   │   ├── sentry.logger.ts          # Sentry integration
│   │   └── datadog.logger.ts         # Datadog integration
│   ├── logger.factory.ts             # Runtime provider selection
│   └── logger.module.ts              # Logger module
│
├── middleware/
│   ├── request-context.service.ts    # AsyncLocalStorage context
│   └── request-context.middleware.ts # HTTP request context
│
├── sentry/
│   ├── sentry-init.service.ts        # Sentry initialization
│   ├── sentry.filter.ts              # Exception tracking
│   ├── sentry.interceptor.ts         # Performance tracing
│   └── sentry.module.ts
│
├── datadog/
│   ├── datadog-init.service.ts       # dd-trace initialization
│   └── datadog.module.ts
│
├── websocket/
│   ├── websocket-context.helper.ts   # WebSocket context tracking
│   ├── websocket.logger.ts           # WebSocket-specific logging
│   └── WEBSOCKET_INTEGRATION.md      # Integration guide
│
└── observability.module.ts           # Main module
```

## ⚙️ Configuration

### Environment Variables

```bash
# App environment
APP_ENV=local | dev | staging | prod

# Logger configuration
LOG_PROVIDER=nest | sentry | datadog
LOG_LEVEL=debug | log | warn | error

# Sentry (optional - for staging/production)
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=staging
SENTRY_RELEASE=v1.0.0
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1

# Datadog (optional - for staging/production)
DATADOG_API_KEY=your-api-key
DATADOG_SERVICE=sports-intelligence-backend
DATADOG_ENV=production
DATADOG_VERSION=1.0.0
DATADOG_SITE=datadoghq.com
```

### Provider Selection Logic

- **local / dev** → Always uses NestJS Logger (regardless of LOG_PROVIDER)
- **staging / prod** → Uses LOG_PROVIDER (falls back to NestJS Logger if provider not configured)

## 🚀 Quick Start

### 1. Installation

Dependencies are already added to package.json:

```bash
npm install
```

This installs:
- `@sentry/node` + `@sentry/profiling-node`
- `dd-trace` (Datadog APM)
- `uuid` (for request IDs)

### 2. Local Development

```bash
# .env
APP_ENV=local
LOG_PROVIDER=nest
LOG_LEVEL=debug
```

That's it! The system automatically uses NestJS Logger in local/dev.

### 3. Using the Logger

#### In Services/Controllers

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { APP_LOGGER, IAppLogger } from '@/observability';

@Injectable()
export class MyService {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: IAppLogger,
  ) {}

  doSomething(): void {
    this.logger.log('Doing something', 'MyService');
    
    try {
      // ... your code
    } catch (error) {
      this.logger.error(
        'Failed to do something',
        error.stack,
        'MyService',
        { extraContext: 'value' },
      );
    }
  }
}
```

#### In WebSocket Gateways

See [WebSocket Integration Guide](./websocket/WEBSOCKET_INTEGRATION.md) for detailed instructions.

```typescript
import { WebSocketLogger, WebSocketContextHelper, ContextSocket } from '@/observability/websocket';

@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway {
  private readonly wsLogger = new WebSocketLogger('NotificationsGateway', true);

  async handleConnection(client: ContextSocket): Promise<void> {
    WebSocketContextHelper.initializeContext(client);
    
    // ... auth logic
    
    WebSocketContextHelper.setUserContext(client, userId, email, orgId);
    this.wsLogger.logConnection(client, userId);
  }
}
```

## 🔧 Setup Guides

### Local Development

1. **Install dependencies**: `npm install`
2. **Configure .env**:
   ```bash
   APP_ENV=local
   LOG_PROVIDER=nest
   LOG_LEVEL=debug
   ```
3. **Start the app**: `npm run start:dev`
4. **All logs go to console** - no external services needed

### Staging with Sentry

1. **Create Sentry project** at [sentry.io](https://sentry.io)
2. **Get DSN** from project settings
3. **Configure .env**:
   ```bash
   APP_ENV=staging
   LOG_PROVIDER=sentry
   LOG_LEVEL=info
   
   SENTRY_DSN=https://...@sentry.io/...
   SENTRY_ENVIRONMENT=staging
   SENTRY_RELEASE=v1.0.0
   SENTRY_TRACES_SAMPLE_RATE=0.1
   SENTRY_PROFILES_SAMPLE_RATE=0.1
   ```
4. **Deploy and verify** - check Sentry dashboard for events

### Production with Datadog

1. **Create Datadog account** at [datadoghq.com](https://www.datadoghq.com)
2. **Get API key** from organization settings
3. **Configure .env**:
   ```bash
   APP_ENV=prod
   LOG_PROVIDER=datadog
   LOG_LEVEL=warn
   
   DATADOG_API_KEY=your-api-key
   DATADOG_SERVICE=sports-intelligence-backend
   DATADOG_ENV=production
   DATADOG_VERSION=1.0.0
   DATADOG_SITE=datadoghq.com
   ```
4. **Install Datadog Agent** (optional, for advanced features):
   ```bash
   # Docker
   docker run -d --name dd-agent \
     -e DD_API_KEY=your-api-key \
     -e DD_SITE=datadoghq.com \
     -v /var/run/docker.sock:/var/run/docker.sock:ro \
     -v /proc/:/host/proc/:ro \
     -v /sys/fs/cgroup/:/host/sys/fs/cgroup:ro \
     datadog/agent:latest
   ```
5. **Deploy and verify** - check Datadog dashboard for logs and traces

## 📊 What Gets Logged

### HTTP Requests

- Request ID (auto-generated UUID)
- User ID (from JWT)
- Organization ID (from JWT or header)
- Request method, URL, headers (sanitized)
- Response status, duration
- Exceptions with full stack trace

### WebSocket Events

- Connection/disconnection events
- Authentication failures
- Event handling (with sanitized payloads)
- Event errors with context
- Anomalous disconnects

### Automatic Context Enrichment

All logs automatically include:
- `requestId` - for correlation across services
- `userId` - authenticated user
- `orgId` - multi-tenant context
- `timestamp` - log creation time

### Sensitive Data Masking

These fields are automatically redacted:
- `password`, `token`, `secret`, `apiKey`, `api_key`
- `authorization`, `cookie`, `creditCard`, `ssn`

## 🧪 Testing

Run the observability test suite:

```bash
# Run all observability tests
npm test -- test/unit/observability

# Run specific test
npm test -- test/unit/observability/logger-factory.spec.ts

# With coverage
npm run test:cov -- test/unit/observability
```

Tests cover:
- ✅ Logger factory provider selection
- ✅ Request context propagation
- ✅ WebSocket context tracking
- ✅ Sensitive data masking
- ✅ Error handling and fallbacks

## 🔍 Troubleshooting

### Logs not appearing in Sentry

1. Check `SENTRY_DSN` is set correctly
2. Verify `APP_ENV` is NOT `local` or `dev`
3. Check Sentry dashboard for rate limiting
4. Test with: `logger.error('Test error', 'stack', 'TestContext')`

### Logs not appearing in Datadog

1. Verify `DATADOG_API_KEY` is set
2. Check `DATADOG_SITE` matches your region
3. Ensure structured JSON logs are enabled
4. Verify Datadog agent is running (if using agent-based setup)

### Request context not propagating

1. Ensure `ObservabilityModule` is imported in `AppModule`
2. Check middleware is applied to all routes
3. For async operations, ensure you're within request scope
4. For WebSocket, use `WebSocketContextHelper.runInContext()`

### TypeScript errors

1. Ensure `@types/uuid` is installed
2. Check TypeScript version compatibility
3. Run `npm install` to refresh types

## 📝 API Reference

### IAppLogger

```typescript
interface IAppLogger {
  log(message: string, context?: string, metadata?: Record<string, unknown>): void;
  error(message: string, trace?: string, context?: string, metadata?: Record<string, unknown>): void;
  warn(message: string, context?: string, metadata?: Record<string, unknown>): void;
  debug(message: string, context?: string, metadata?: Record<string, unknown>): void;
  verbose(message: string, context?: string, metadata?: Record<string, unknown>): void;
}
```

### RequestContextService

```typescript
class RequestContextService {
  static run<T>(context: RequestContext, callback: () => T): T;
  static getContext(): RequestContext | undefined;
  static getRequestId(): string | undefined;
  static getUserId(): string | undefined;
  static getOrgId(): string | undefined;
  static updateContext(updates: Partial<RequestContext>): void;
}
```

### WebSocketContextHelper

```typescript
class WebSocketContextHelper {
  static initializeContext(socket: ContextSocket): void;
  static runInContext<T>(socket: ContextSocket, fn: () => T): T;
  static setUserContext(socket: ContextSocket, userId: string, email?: string, orgId?: string): void;
  static getSocketContext(socket: ContextSocket): { requestId?, userId?, orgId? };
}
```

### WebSocketLogger

```typescript
class WebSocketLogger {
  constructor(gatewayName: string, enableSentry?: boolean);
  
  logConnection(socket: ContextSocket, userId?: string): void;
  logDisconnection(socket: ContextSocket, reason?: string): void;
  logAuthFailure(socket: ContextSocket, reason: string): void;
  logEvent(socket: ContextSocket, eventName: string, payload?: unknown, sanitize?: boolean): void;
  logEventError(socket: ContextSocket, eventName: string, error: Error, payload?: unknown): void;
  logAnomalousDisconnect(socket: ContextSocket, reason: string): void;
}
```

## 🎯 Best Practices

1. **Always inject APP_LOGGER** instead of using NestJS Logger directly
2. **Use meaningful context names** (class name, module name)
3. **Include metadata** for debugging (user IDs, resource IDs, etc.)
4. **Log at appropriate levels**:
   - `debug`: Development-only detailed logs
   - `log`: Normal application flow
   - `warn`: Recoverable errors, deprecated usage
   - `error`: Unrecoverable errors requiring attention
5. **For WebSocket**, always initialize context in `handleConnection`
6. **Test locally first** with `APP_ENV=local` before deploying
7. **Set appropriate sample rates** in production to control costs

## 🔐 Security

- Sensitive data is automatically masked in logs
- JWT tokens are never logged
- Passwords, secrets, API keys are redacted
- Request headers are sanitized
- Custom sensitive fields can be added to masking logic

## 📈 Performance

- Request context uses AsyncLocalStorage (zero overhead)
- Sampling rates control volume sent to external services
- Fallback to NestJS Logger is instantaneous
- No blocking operations in logging path

## 🤝 Contributing

When adding new features:

1. Add tests to `test/unit/observability/`
2. Update relevant documentation
3. Ensure backward compatibility
4. Test with all three providers (Nest, Sentry, Datadog)

## 📄 License

UNLICENSED - Internal use only
