import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantContext, TenantRequest } from '../types/tenant-context';

/**
 * @CurrentTenant()
 *
 * Param decorator that injects the TenantContext (or a single field) into a
 * controller handler parameter.
 *
 * Usage:
 *   // Get the full context
 *   async myHandler(@CurrentTenant() tenant: TenantContext) { ... }
 *
 *   // Get only the tenantId string
 *   async myHandler(@CurrentTenant('tenantId') tenantId: string) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (field: keyof TenantContext | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<TenantRequest>();
    const tenantContext = request.tenantContext;
    if (!tenantContext) return undefined;
    return field ? tenantContext[field] : tenantContext;
  },
);
