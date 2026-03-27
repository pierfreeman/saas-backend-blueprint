import { MembershipRole } from '@prisma/client';
import { PermissionKey, PERMISSIONS } from './permissions.constants';

export const ROLES = {
  OWNER: 'OWNER' as MembershipRole,
  ADMIN: 'ADMIN' as MembershipRole,
  MEMBER: 'MEMBER' as MembershipRole,
  READ_ONLY: 'READ_ONLY' as MembershipRole,
} as const;

/**
 * Role hierarchy — higher index = more permissions.
 * Used for hierarchical role checks.
 */
export const ROLE_HIERARCHY: MembershipRole[] = [
  'READ_ONLY',
  'MEMBER',
  'ADMIN',
  'OWNER',
];

export function isRoleHigherOrEqual(
  userRole: MembershipRole,
  requiredRole: MembershipRole,
): boolean {
  const userIndex = ROLE_HIERARCHY.indexOf(userRole);
  const requiredIndex = ROLE_HIERARCHY.indexOf(requiredRole);
  if (userIndex === -1 || requiredIndex === -1) return false;
  return userIndex >= requiredIndex;
}

/**
 * Static role → permissions map.
 *
 * This replaces the database-driven Role/Permission tables.
 * Add or remove permissions here as the product evolves.
 */
export const ROLE_PERMISSIONS: Record<MembershipRole, PermissionKey[]> = {
  OWNER: [
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.ORG_BILLING_MANAGE,
    PERMISSIONS.ORG_MEMBERS_INVITE,
    PERMISSIONS.ORG_MEMBERS_REMOVE,
    PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.AUDIT_READ,
    // PERMISSIONS.TEAM_CREATE,
    // PERMISSIONS.TEAM_UPDATE,
    // PERMISSIONS.TEAM_DELETE,
    // PERMISSIONS.TEAM_READ,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
    PERMISSIONS.PLANNING_MANAGE,
  ],
  ADMIN: [
    PERMISSIONS.ORG_MANAGE,
    PERMISSIONS.ORG_MEMBERS_INVITE,
    PERMISSIONS.ORG_MEMBERS_REMOVE,
    PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.AUDIT_READ,
    // PERMISSIONS.TEAM_CREATE,
    // PERMISSIONS.TEAM_UPDATE,
    // PERMISSIONS.TEAM_DELETE,
    // PERMISSIONS.TEAM_READ,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.PLANNING_MANAGE,
  ],
  MEMBER: [
    PERMISSIONS.ORG_READ,
    // PERMISSIONS.TEAM_CREATE,
    // PERMISSIONS.TEAM_UPDATE,
    // PERMISSIONS.TEAM_READ,
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.PLANNING_MANAGE,
  ],
  READ_ONLY: [PERMISSIONS.ORG_READ /* PERMISSIONS.TEAM_READ */],
};
