import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter.
 *
 * Catches all unhandled exceptions and returns a consistent JSON error shape:
 * {
 *   statusCode, timestamp, path, method, message
 * }
 *
 * Log severity:
 *   - 5xx  → ERROR (with full stack trace)
 *   - 404 on browser-generated asset paths (favicon, robots.txt) → silently ignored
 *   - other 4xx → WARN (no stack, expected client errors)
 *
 * Register globally in main.ts:
 *   app.useGlobalFilters(new AllExceptionsFilter());
 */

/** Paths that browsers request automatically — log noise, never an actionable server error. */
const SILENT_PATHS = new Set([
  '/favicon.ico',
  '/favicon.png',
  '/robots.txt',
  '/apple-touch-icon.png',
]);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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
        : ((rawMessage as Record<string, unknown>).message ?? rawMessage);

    const label = `${request.method} ${request.url} → ${status}`;

    if (status >= 500) {
      this.logger.error(
        label,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (!SILENT_PATHS.has(request.url)) {
      this.logger.warn(label);
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
