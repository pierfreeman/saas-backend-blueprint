import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
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
 * RequestLoggingInterceptor
 *
 * Logs every inbound HTTP request with structured metadata on completion:
 *   - HTTP method, URL, status code, duration (ms)
 *   - tenantId, actorRole from request context (when available)
 *
 * Only runs for HTTP contexts — transparent for WebSocket / microservice.
 *
 * Registration in main.ts (before business interceptors):
 *   app.useGlobalInterceptors(app.get(RequestLoggingInterceptor), ...);
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: ObservabilityLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const res = context.switchToHttp().getResponse<Response>();
    const startAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logRequest(req, res.statusCode, Date.now() - startAt);
        },
        error: () => {
          // Error details are logged by ObservabilityExceptionFilter;
          // log the request metadata here so it's correlated in the same trace.
          this.logRequest(req, res.statusCode || 500, Date.now() - startAt);
        },
      }),
    );
  }

  private logRequest(
    req: RequestWithContext,
    statusCode: number,
    durationMs: number,
  ): void {
    const meta: LogContext = {
      method: req.method,
      path: req.url,
      statusCode,
      durationMs,
      tenantId: req.tenantContext?.tenantId,
      actorRole: req.tenantContext?.role,
    };

    const message = `${req.method} ${req.url} ${statusCode} ${durationMs}ms`;

    if (statusCode >= 500) {
      this.logger.warnCtx(message, meta, RequestLoggingInterceptor.name);
    } else {
      this.logger.logCtx(message, meta, RequestLoggingInterceptor.name);
    }
  }
}
