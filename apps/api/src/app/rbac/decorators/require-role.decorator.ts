import { SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

export const REQUIRE_ROLE_KEY = 'rbac:require-role';

/**
 * Require specific role(s) to access a route.
 * The user must have at least one of the provided roles.
 *
 * @example
 * ```typescript
 * @RequireRole('OWNER', 'ADMIN')
 * deleteOrg() { ... }
 * ```
 */
export const RequireRole = (...roles: MembershipRole[]) =>
  SetMetadata(REQUIRE_ROLE_KEY, roles);
