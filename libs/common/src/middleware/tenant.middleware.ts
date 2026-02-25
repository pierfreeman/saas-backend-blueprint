import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, TenantRequest } from '../types/tenant-context';

/**
 * Tenant Middleware
 * Extracts tenant ID from request headers and attaches to request context
 * Header: x-tenant-id
 *
 * TODO: In production, validate tenant exists in database and user has access
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  use(req: Request & TenantRequest, res: Response, next: NextFunction) {
    const tenantId = req.headers['x-tenant-id'] as string;

    if (tenantId) {
      req.tenantContext = {
        tenantId,
        timestamp: new Date(),
      };
      this.logger.debug(`Tenant context set: ${tenantId}`);
    } else {
      this.logger.warn('Request received without x-tenant-id header');
    }

    next();
  }
}
