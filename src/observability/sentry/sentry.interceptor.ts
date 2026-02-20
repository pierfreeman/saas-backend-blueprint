import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';
import { RequestContextService } from '../middleware/request-context.service';

/**
 * Sentry Performance Interceptor
 *
 * Tracks performance of HTTP requests and adds distributed tracing.
 * Creates transactions for each request and measures execution time.
 */
@Injectable()
export class SentryInterceptor implements NestInterceptor {
	private readonly logger = new Logger(SentryInterceptor.name);

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		const request = context.switchToHttp().getRequest();
		const requestContext = RequestContextService.getContext();
		const scope = Sentry.getCurrentScope();

		// Start a Sentry transaction for this request
		const transaction = Sentry.startInactiveSpan({
			op: 'http.server',
			name: `${request.method} ${request.route?.path || request.url}`,
			attributes: {
				method: request.method,
				url: request.url,
				...(requestContext?.requestId && { requestId: requestContext.requestId }),
				...(requestContext?.userId && { userId: requestContext.userId }),
				...(requestContext?.orgId && { organizationId: requestContext.orgId }),
			},
		});

		// Set user on scope
		if (requestContext?.userId) {
			scope.setUser({ id: requestContext.userId });
		}

		const startTime = Date.now();

		return next.handle().pipe(
			tap(() => {
				// Request successful
				const duration = Date.now() - startTime;

				scope.setTag('status', 'success');
				Sentry.setMeasurement('duration', duration, 'millisecond');
				transaction.end();

				this.logger.debug(`Request completed in ${duration}ms: ${request.method} ${request.url}`);
			}),
			catchError((error) => {
				// Request failed
				const duration = Date.now() - startTime;

				scope.setTag('status', 'error');
				Sentry.setMeasurement('duration', duration, 'millisecond');
				transaction.end();

				// Re-throw to let the exception filter handle it
				throw error;
			}),
		);
	}
}
