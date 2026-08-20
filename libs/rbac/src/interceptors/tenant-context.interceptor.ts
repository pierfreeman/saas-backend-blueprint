import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenantContext } from '@libs/prisma-business';
import { RequestWithOrgContext } from '../guards/org-context.guard';

/**
 * TenantContextInterceptor
 *
 * Pipeline position: global interceptor, registered FIRST in
 * `app.useGlobalInterceptors(...)` so its AsyncLocalStorage scope wraps
 * every other interceptor and the controller handler.
 *
 * Interceptors run after guards complete, so `request.orgId` (set by
 * OrgContextGuard, when the route is `@OrgScoped()`) is already resolved
 * by the time this runs. It propagates that value via `runWithTenant` so
 * PrismaBusinessService's tenant-scoped delegates (this.membership,
 * this.job, ...) can read it back and back the RLS policies — see
 * libs/prisma-business/src/tenant-context.ts and prisma-business.service.ts
 * for why this must be an ALS `.run()` wrapping `next.handle()`'s
 * `subscribe()` call specifically, not a Prisma Client Extension hook.
 *
 * Routes with no org context (orgId undefined — not `@OrgScoped()`, or the
 * guard didn't resolve one) run with `orgId: null`, which fails RLS closed
 * for any tenant-scoped query they happen to make — correct behavior for a
 * route that has no business touching tenant data.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context
      .switchToHttp()
      .getRequest<RequestWithOrgContext>();
    const orgId = request.orgId ?? null;
    const userId = request.user?.dbUserId ?? null;

    return new Observable((subscriber) => {
      runWithTenantContext({ orgId, userId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
