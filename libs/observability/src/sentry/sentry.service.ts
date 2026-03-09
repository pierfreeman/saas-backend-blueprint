import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { SentryContext } from '../logger/logger.interfaces';

/**
 * SentryService
 *
 * DI wrapper around `@sentry/node` that enables:
 *  - Easy mocking in unit tests (replace with jest.fn() stubs)
 *  - Multi-tenant isolation via `withScope` — each `captureException` call
 *    runs in a forked scope, preventing tenant context leaking across events
 *  - Safe no-op when Sentry is disabled (SENTRY_ENABLED=false)
 *
 * Initialization note
 * ─────────────────────────────────────────────────────────────────────────────
 * `Sentry.init()` MUST be called at the very top of `main.ts` before
 * `NestFactory.create()`. This service uses the already-initialised SDK;
 * it does NOT call `Sentry.init()` itself. See each app's `main.ts`.
 *
 * Multi-tenant safety
 * ─────────────────────────────────────────────────────────────────────────────
 * Each capture call forks a new scope (`Sentry.withScope`) so tenant tags
 * are scoped to that event only and cannot bleed into other concurrent events.
 * Only opaque IDs are tagged — never PII (names, emails, etc.).
 */
@Injectable()
export class SentryService {
  /**
   * Capture an exception and attach optional tenant/request context.
   *
   * @example
   * this.sentry.captureException(err, { tenantId, orgId, actorRole });
   */
  captureException(exception: Error | unknown, context?: SentryContext): void {
    Sentry.withScope((scope) => {
      this.applyContext(scope, context);
      Sentry.captureException(exception);
    });
  }

  /**
   * Capture a message-level event (non-error notifications).
   */
  captureMessage(
    message: string,
    level: 'info' | 'warning' | 'error' = 'info',
    context?: SentryContext,
  ): void {
    Sentry.withScope((scope) => {
      this.applyContext(scope, context);
      Sentry.captureMessage(message, level);
    });
  }

  /**
   * Execute a callback inside an isolated Sentry scope.
   * Useful for attaching context to a block of related captures.
   */
  withScope(
    fn: (scope: ReturnType<typeof Sentry.getCurrentScope>) => void,
  ): void {
    Sentry.withScope(fn);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private applyContext(
    scope: ReturnType<typeof Sentry.getCurrentScope>,
    context?: SentryContext,
  ): void {
    if (!context) return;

    // Sentry user: only ID, never email (multi-tenant PII safety)
    if (context.userId) {
      scope.setUser({ id: context.userId });
    }

    // Structured tags for filtering in Sentry dashboard
    if (context.tenantId) scope.setTag('tenantId', context.tenantId);
    if (context.orgId) scope.setTag('orgId', context.orgId);
    if (context.actorRole) scope.setTag('actorRole', context.actorRole);
    if (context.requestId) scope.setTag('requestId', context.requestId);
  }
}
