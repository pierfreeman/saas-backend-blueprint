/**
 * Tenant Context
 * Holds tenant (organization) information for the current request.
 *
 * Populated in two stages:
 *  1. TenantMiddleware – sets tenantId from x-org-id / x-tenant-id header (early, pre-auth)
 *  2. OrgContextGuard – enriches with userId / roles / permissions after JWT validation
 */
export interface TenantContext {
  /** Organization ID (== orgId from the request params/header) */
  tenantId: string;
  /** Resolved DB user ID (available after OrgContextGuard) */
  userId?: string;
  /** RBAC role for this org (available after RBACGuard) */
  role?: string;
  /** Resolved permission strings (available after RBACGuard) */
  permissions?: string[];
  timestamp: Date;
}

/**
 * Request with tenant context
 * Extends Express Request to include tenant info
 */
export interface TenantRequest {
  tenantContext?: TenantContext;
}
