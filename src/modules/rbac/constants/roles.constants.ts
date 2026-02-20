import { MembershipRole } from '@prisma/client';

/**
 * RBAC Role constants
 */
export const ROLES = {
  OWNER: 'OWNER' as MembershipRole,
  ADMIN: 'ADMIN' as MembershipRole,
  MEMBER: 'MEMBER' as MembershipRole,
  COACH: 'COACH' as MembershipRole,
  VIEWER: 'VIEWER' as MembershipRole,
  READ_ONLY: 'READ_ONLY' as MembershipRole,
} as const;

/**
 * Role hierarchy for implicit permissions
 * Higher index = more permissions
 */
export const ROLE_HIERARCHY: MembershipRole[] = [
  'READ_ONLY',
  'VIEWER',
  'COACH',
  'MEMBER',
  'ADMIN',
  'OWNER',
];

/**
 * Check if a role has higher or equal privileges than another
 */
export function isRoleHigherOrEqual(
  userRole: MembershipRole,
  requiredRole: MembershipRole,
): boolean {
  const userIndex = ROLE_HIERARCHY.indexOf(userRole);
  const requiredIndex = ROLE_HIERARCHY.indexOf(requiredRole);

  if (userIndex === -1 || requiredIndex === -1) {
    return false;
  }

  return userIndex >= requiredIndex;
}
