import { SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

export const REQUIRE_ROLE_KEY = 'rbac:require-role';

/**
 * Require specific role to access route
 * @param roles - List of allowed roles (user needs at least one)
 *
 * @example
 * ```typescript
 * @RequireRole(['OWNER', 'ADMIN'])
 * deleteOrganization() { ... }
 * ```
 */
export const RequireRole = (...roles: MembershipRole[]) => SetMetadata(REQUIRE_ROLE_KEY, roles);
