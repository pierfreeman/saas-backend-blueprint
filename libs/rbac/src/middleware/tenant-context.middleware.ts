import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { runWithTenant } from '@libs/prisma-business';
import { TenantRequest } from '@libs/common';

/**
 * TenantContextMiddleware
 *
 * Establishes the AsyncLocalStorage tenant context (see
 * libs/prisma-business/src/tenant-context.ts) as early as possible in the
 * pipeline — registered right after `TenantMiddleware` (@libs/common),
 * which does the early best-effort orgId extraction from headers/route
 * params this middleware reads back from `req.tenantContext.tenantId`.
 *
 * This MUST run in middleware, not an interceptor: OrgContextGuard itself
 * queries `memberships`/`organizations` (via PrismaBusinessService's
 * RLS-scoped proxy) to verify membership — and guards run *before* any
 * interceptor in Nest's request lifecycle. An interceptor-based approach
 * would leave OrgContextGuard's own queries running with no tenant context
 * at all, making every org-scoped request fail closed (403/404) even for
 * legitimate, correctly-authorised callers.
 *
 * The header/param-derived orgId here is a *claim*, not yet authorised —
 * that's still OrgContextGuard's job. Scoping RLS to an unverified orgId is
 * safe: RLS only governs which rows a query can see, not which user is
 * allowed to ask for them. If OrgContextGuard finds the caller isn't a
 * member, it still throws regardless of what RLS would have allowed to be
 * visible. TenantContextInterceptor (@libs/rbac) later re-establishes the
 * context from the guard-validated `request.orgId` for the controller and
 * service layers, which can differ from this early guess (e.g. resolved
 * via `body.orgId`, or `params.id` on an `@OrgScoped()` route) — nested
 * `runWithTenant` calls simply override for their own scope.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request & TenantRequest, res: Response, next: NextFunction): void {
    const orgId = req.tenantContext?.tenantId ?? null;
    runWithTenant(orgId, () => next());
  }
}
