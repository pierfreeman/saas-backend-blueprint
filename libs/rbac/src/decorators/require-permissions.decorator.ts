import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '@libs/common';

export const PERMISSIONS_KEY = 'rbac:permissions';

export type PermissionMode = 'ANY' | 'ALL';

export interface PermissionsMetadata {
  permissions: (PermissionKey | (string & {}))[];
  mode: PermissionMode;
}

/**
 * Require specific permissions to access a route.
 *
 * @param permissions - List of permissions required
 * @param mode - `'ANY'` (at least one) | `'ALL'` (all required). Defaults to `'ANY'`.
 *
 * @example
 * ```typescript
 * @RequirePermissions([PERMISSIONS.ORG_MANAGE])
 * updateOrg() { ... }
 *
 * @RequirePermissions([PERMISSIONS.TEAM_UPDATE, PERMISSIONS.TEAM_DELETE], 'ALL')
 * batchEditTeam() { ... }
 * ```
 */
export const RequirePermissions = (
  permissions: (PermissionKey | (string & {}))[],
  mode: PermissionMode = 'ANY',
) =>
  SetMetadata<string, PermissionsMetadata>(PERMISSIONS_KEY, {
    permissions,
    mode,
  });
