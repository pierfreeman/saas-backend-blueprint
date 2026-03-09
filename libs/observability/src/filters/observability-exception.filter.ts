import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ObservabilityLoggerService } from '../logger/logger.service';
import { LogContext } from '../logger/logger.interfaces';

interface RequestWithContext extends Request {
  tenantContext?: {
    tenantId?: string;
    userId?: string;
    role?: string;
  };
}

/**
 * Paths browsers request automatically — suppress to avoid log noise.
 * Never an actionable server error.
 */
const SILENT_PATHS = new Set([
  '/favicon.ico',
  '/favicon.png',
  '/robots.txt',
  '/apple-touch-icon.png',
]);

/**
 * ObservabilityExceptionFilter
 *
 * Enhanced global exception filter that extends the functionality of the
 * existing `AllExceptionsFilter` with:
 *   - Structured logging via ObservabilityLoggerService (JSON in production)
 *   - Sentry capture for server errors (5xx) with tenant context tags
 *   - Multi-tenant safe: only opaque IDs are logged / sent to Sentry
 *
 * Error response shape (unchanged from AllExceptionsFilter):
 *   { statusCode, timestamp, path, method, message }
 *
 * Log severity:
 *   - 5xx  → ERROR  (with stack trace) + Sentry capture
 *   - SILENT_PATHS → suppressed
 *   - other 4xx → WARN  (no stack)
 *
 * Sentry capture
 * ────────────────────────────────────────────────────────────────────────────
 * This filter intentionally does NOT capture to Sentry. That is the
 * responsibility of SentryInterceptor, which runs earlier in the pipeline and
 * has access to the same request context. Separating the concerns prevents
 * duplicate Sentry events when both interceptor and filter are registered.
 *
 * Registration in main.ts (replaces AllExceptionsFilter):
 *   app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
 */
@Catch()
@Injectable()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: ObservabilityLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    const message =
      typeof rawMessage === 'string'
        ? rawMessage
        : ((rawMessage as Record<string, unknown>)['message'] ?? rawMessage);

    const label = `${request.method} ${request.url} → ${status}`;

    const meta: LogContext = {
      tenantId: request.tenantContext?.tenantId,
      userId: request.tenantContext?.userId,
      actorRole: request.tenantContext?.role,
      method: request.method,
      path: request.url,
      statusCode: status,
    };

    if (status >= 500) {
      this.logger.errorCtx(
        label,
        exception instanceof Error
          ? exception
          : new Error(JSON.stringify(exception)),
        meta,
        ObservabilityExceptionFilter.name,
      );
    } else if (!SILENT_PATHS.has(request.url)) {
      this.logger.warnCtx(label, meta, ObservabilityExceptionFilter.name);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
    });
  }
}
