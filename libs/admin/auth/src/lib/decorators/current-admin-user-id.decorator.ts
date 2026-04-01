import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminRequest } from '../guards/system-admin.guard';

/**
 * Extracts the DB user ID of the authenticated system admin.
 * Only valid on routes protected by SystemAdminGuard.
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
    return request.user?.dbUserId;
  },
);
