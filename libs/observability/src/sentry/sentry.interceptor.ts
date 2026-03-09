import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { Request } from 'express';
import { SentryService } from './sentry.service';
import { SentryContext } from '../logger/logger.interfaces';

interface RequestWithContext extends Request {
  tenantContext?: {
    tenantId?: string;
    userId?: string;
    role?: string;
  };
}

/**
 * SentryInterceptor
 *
 * NestJS interceptor that catches unhandled exceptions in controller pipelines
 * and sends them to Sentry with multi-tenant context tags.
 *
 * Scope
 * ─────
 * Only server errors (HTTP 5xx / non-HTTP) are forwarded to Sentry.
 * Client errors (4xx) are expected and not reported.
 *
 * The interceptor always re-throws the exception so downstream filters
 * (e.g. ObservabilityExceptionFilter) can still format the HTTP response.
 *
 * Registration (in main.ts):
 *   app.useGlobalInterceptors(app.get(SentryInterceptor), ...);
 *
 * Non-HTTP contexts (WebSocket, microservice):
 * The interceptor guards against non-HTTP contexts; for those, Sentry
 * capture must be triggered by the handler or a global filter.
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
  constructor(private readonly sentry: SentryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        const isServerError =
          !(err instanceof HttpException) || err.getStatus() >= 500;

        if (isServerError && context.getType() === 'http') {
          const req = context.switchToHttp().getRequest<RequestWithContext>();

          const sentryCtx: SentryContext = {
            tenantId: req.tenantContext?.tenantId,
            orgId: req.tenantContext?.tenantId,
            actorRole: req.tenantContext?.role,
            userId: req.tenantContext?.userId,
          };

          this.sentry.captureException(err, sentryCtx);
        }

        return throwError(() => err);
      }),
    );
  }
}
