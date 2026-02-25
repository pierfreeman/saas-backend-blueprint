import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, TenantRequest } from '../types/tenant-context';

/**
 * Tenant Middleware
 *
 * Stage 1: Early extraction (runs before auth guards).
 * Resolves tenantId from, in order of priority:
 *   1. x-org-id header       (preferred – set by trusted clients / gateway)
 *   2. x-tenant-id header    (legacy alias)
 *   3. :orgId route param    (for nested routes like /organizations/:orgId/...)
 *
 * Stage 2 enrichment (userId, role, permissions) is done by OrgContextGuard
 * after JWT validation and membership check.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  use(req: Request & TenantRequest, res: Response, next: NextFunction) {
    const tenantId =
      (req.headers['x-org-id'] as string | undefined) ??
      (req.headers['x-tenant-id'] as string | undefined) ??
      (req.params?.['orgId'] as string | undefined);

    if (tenantId) {
      req.tenantContext = {
        tenantId,
        timestamp: new Date(),
      } satisfies TenantContext;
      this.logger.debug(`Tenant context initialised: ${tenantId}`);
    } else {
      this.logger.debug('No tenant identifier found in request headers/params');
    }

    next();
  }
}
