/**
 * PlanEntitlements
 * Boolean feature gates derived from an organization's subscription tier.
 * Numeric resource limits (e.g. maxSeats) are included here alongside boolean
 * feature flags so that a single cache entry carries the full picture.
 */
export interface PlanEntitlements {
  advancedAnalytics: boolean;
  customReports: boolean;
  apiAccess: boolean;
  ssoEnabled: boolean;
  prioritySupport: boolean;
  /** Maximum number of members allowed by this plan. 999999 means virtually unlimited. */
  maxSeats: number;
  /** Total storage quota in bytes for the plan. Used for display and enforcement — overrides the plan-tier config default in StorageController. */
  storageLimitBytes: number;
}

/**
 * OrganizationEntitlements
 * Extends PlanEntitlements with the organization and subscription context
 * so the full object can be returned via the API.
 */
export interface OrganizationEntitlements extends PlanEntitlements {
  /** UUID of the organization these entitlements belong to. */
  organizationId: string;
  /** Internal plan tier: FREE | PRO | ENTERPRISE */
  plan: string;
  /** BillingStatus value from the organization record (e.g. ACTIVE, PAST_DUE). */
  subscriptionStatus: string;
}
