import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extract current user's database ID from request
 * Requires JWT authentication and user lookup
 */
export const CurrentUserId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user?.dbUserId; // Set by OrgContextGuard
});

/**
 * Extract current organization ID from request
 * Requires OrgContextGuard or OrgScopeGuard
 */
export const CurrentOrgId = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.orgId; // Set by OrgContextGuard
});

/**
 * Extract full RBAC context from request
 */
export const RBACContext = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return {
    userId: request.user?.dbUserId,
    orgId: request.orgId,
    role: request.rbacRole,
    permissions: request.rbacPermissions,
  };
});
