export interface PlanEntitlements {
  maxTeams: number;
  maxPlayers: number;
  maxCoaches: number;
  advancedAnalytics: boolean;
  customReports: boolean;
  apiAccess: boolean;
  ssoEnabled: boolean;
  prioritySupport: boolean;
}

export interface OrganizationEntitlements extends PlanEntitlements {
  organizationId: string;
  plan: string;
  subscriptionStatus: string;
}
