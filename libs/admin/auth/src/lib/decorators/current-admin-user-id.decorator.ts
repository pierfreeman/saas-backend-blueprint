import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

type AdminRequest = Request & { user?: { adminUserId?: string } };

/**
 * Extracts the internal ID of the authenticated admin user.
 *
 * `AdminJwtAuthGuard` sets `request.user.adminUserId`.
 *
 * @example
 * ```ts
 * @Get('organizations')
 * listOrgs(@CurrentAdminUserId() adminUserId: string) { ... }
 * ```
 */
export const CurrentAdminUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<AdminRequest>();
    return request.user?.adminUserId;
  },
);
