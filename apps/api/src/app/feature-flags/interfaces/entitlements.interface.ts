/**
 * PlanEntitlements
 * Boolean feature gates derived from an organization's subscription tier.
 * All fields are booleans — numeric resource limits are handled separately
 * via FeatureFlagsService.checkLimit().
 */
export interface PlanEntitlements {
  advancedAnalytics: boolean;
  customReports: boolean;
  apiAccess: boolean;
  ssoEnabled: boolean;
  prioritySupport: boolean;
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
