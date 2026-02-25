/**
 * Tenant Context
 * Holds tenant information for the current request
 */
export interface TenantContext {
  tenantId: string;
  userId?: string;
  timestamp: Date;
}

/**
 * Request with tenant context
 * Extends Express Request to include tenant info
 */
export interface TenantRequest {
  tenantContext?: TenantContext;
}
