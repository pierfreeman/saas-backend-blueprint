import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { RequestContextService } from '../middleware/request-context.service';

/**
 * Sentry Exception Filter
 *
 * Catches all unhandled exceptions and sends them to Sentry with full context.
 * Works alongside the existing AllExceptionsFilter.
 */
@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : exception.message || 'Internal server error';

    // Get request context
    const context = RequestContextService.getContext();

    // Log locally
    this.logger.error(`Exception caught: ${exception.message}`, exception.stack);

    // Send to Sentry with full context
    Sentry.withScope((scope) => {
      // Set request context
      if (context) {
        scope.setTag('requestId', context.requestId);
        if (context.userId) {
          scope.setUser({ id: context.userId });
        }
        if (context.orgId) {
          scope.setTag('organizationId', context.orgId);
        }
      }

      // Set HTTP context
      scope.setContext('http', {
        method: request.method,
        url: request.url,
        query: request.query,
        headers: this.sanitizeHeaders(request.headers),
        statusCode: status,
      });

      // Set extra details
      scope.setExtra('body', this.sanitizeBody(request.body));
      scope.setExtra('params', request.params);
      scope.setLevel(status >= 500 ? 'error' : 'warning');

      // Capture exception
      if (exception instanceof HttpException) {
        // For HTTP exceptions, capture as message (less noisy)
        Sentry.captureMessage(
          `HTTP ${status}: ${typeof message === 'string' ? message : JSON.stringify(message)}`,
          status >= 500 ? 'error' : 'warning',
        );
      } else {
        // For unexpected errors, capture as exception
        Sentry.captureException(exception);
      }
    });

    // Don't send response - let the AllExceptionsFilter handle it
    // This filter only handles Sentry reporting
  }

  private sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];

    for (const key of sensitiveHeaders) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sanitized = { ...body } as Record<string, unknown>;
    const sensitiveFields = ['password', 'token', 'secret', 'creditCard', 'ssn'];

    for (const key in sanitized) {
      if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
