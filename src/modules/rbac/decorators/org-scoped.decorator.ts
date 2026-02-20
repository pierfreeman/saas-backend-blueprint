import { SetMetadata } from '@nestjs/common';

export const ORG_SCOPED_KEY = 'rbac:org-scoped';

/**
 * Mark route as requiring organization context
 * This ensures that the OrgContextGuard validates org membership
 *
 * @example
 * ```typescript
 * @OrgScoped()
 * @Get(':orgId/teams')
 * getTeams() { ... }
 * ```
 */
export const OrgScoped = () => SetMetadata(ORG_SCOPED_KEY, true);
