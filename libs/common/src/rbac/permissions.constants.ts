export const PERMISSIONS = {
  // Organization
  ORG_MANAGE: 'org.manage',
  ORG_BILLING_MANAGE: 'org.billing.manage',
  ORG_MEMBERS_INVITE: 'org.members.invite',
  ORG_MEMBERS_REMOVE: 'org.members.remove',
  ORG_MEMBERS_ROLE_UPDATE: 'org.members.role.update',
  ORG_READ: 'org.read',

  // Audit (ISO 27001 A.8.15 – restricted to OWNER/ADMIN)
  AUDIT_READ: 'audit.read',

  // Team
  // TEAM_CREATE: 'team.create',
  // TEAM_UPDATE: 'team.update',
  // TEAM_DELETE: 'team.delete',
  // TEAM_READ: 'team.read',

  // Analytics
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_EXPORT: 'analytics.export',

  // Planning / Calendar
  PLANNING_MANAGE: 'planning.manage',
  /** Can edit/delete ANY event (not just own). ADMIN and OWNER only. */
  PLANNING_MANAGE_ANY: 'planning.manage_any',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
