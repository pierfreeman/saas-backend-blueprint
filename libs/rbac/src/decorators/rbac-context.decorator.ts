import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** DB user id injected by OrgContextGuard */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.dbUserId as string | undefined;
  },
);

/** orgId injected by OrgContextGuard */
export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.orgId as string | undefined;
  },
);

/** Full RBAC context injected by OrgContextGuard + RBACGuard */
export const RBACContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return {
      userId: request.user?.dbUserId as string | undefined,
      orgId: request.orgId as string | undefined,
      role: request.rbacRole as string | undefined,
      permissions: request.rbacPermissions as string[] | undefined,
    };
  },
);
