import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestContextService } from './request-context.service';

/**
 * Request Context Middleware
 *
 * Initializes request context for each incoming HTTP request.
 * Generates a unique requestId and extracts userId/orgId from JWT if present.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = this.getOrGenerateRequestId(req);
    const userId = this.extractUserId(req);
    const orgId = this.extractOrgId(req);

    // Set response header for request tracking
    res.setHeader('X-Request-Id', requestId);

    // Run the rest of the request pipeline within this context
    RequestContextService.run(
      {
        requestId,
        userId,
        orgId,
        timestamp: new Date(),
      },
      () => {
        next();
      },
    );
  }

  private getOrGenerateRequestId(req: Request): string {
    // Check if client sent a request ID
    const clientRequestId = req.headers['x-request-id'] as string;
    if (clientRequestId && typeof clientRequestId === 'string') {
      return clientRequestId;
    }

    // Generate a new UUID
    return uuidv4();
  }

  private extractUserId(req: Request): string | undefined {
    // Extract from JWT payload (set by Auth0 JWT strategy)
    const user = (req as any).user;
    if (user?.sub) {
      return user.sub;
    }
    return undefined;
  }

  private extractOrgId(req: Request): string | undefined {
    // Extract from JWT payload custom claim
    const user = (req as any).user;
    if (user?.orgId) {
      return user.orgId;
    }

    // Fallback: extract from custom header
    const orgIdHeader = req.headers['x-organization-id'] as string;
    if (orgIdHeader) {
      return orgIdHeader;
    }

    return undefined;
  }
}
