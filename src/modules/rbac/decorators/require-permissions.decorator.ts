import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../constants/permissions.constants';

export const PERMISSIONS_KEY = 'rbac:permissions';

export type PermissionMode = 'ANY' | 'ALL';

export interface PermissionsMetadata {
  permissions: (PermissionKey | string)[];
  mode: PermissionMode;
}

/**
 * Require specific permissions to access route
 * @param permissions - List of permissions required
 * @param mode - 'ANY' (user needs at least one) or 'ALL' (user needs all permissions)
 *
 * @example
 * ```typescript
 * @RequirePermissions([PERMISSIONS.TEAM_CREATE])
 * createTeam() { ... }
 *
 * @RequirePermissions([PERMISSIONS.TEAM_UPDATE, PERMISSIONS.TEAM_DELETE], 'ALL')
 * updateAndDeleteTeam() { ... }
 * ```
 */
export const RequirePermissions = (
  permissions: (PermissionKey | string)[],
  mode: PermissionMode = 'ANY',
) => SetMetadata<string, PermissionsMetadata>(PERMISSIONS_KEY, { permissions, mode });
