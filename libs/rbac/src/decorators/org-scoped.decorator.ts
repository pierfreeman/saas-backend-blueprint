import { SetMetadata } from '@nestjs/common';

export const ORG_SCOPED_KEY = 'rbac:org-scoped';

/**
 * Mark a route as requiring organization context.
 * `OrgContextGuard` will throw `BadRequestException` if no orgId is found.
 *
 * @example
 * ```typescript
 * @OrgScoped()
 * @Get(':orgId/members')
 * getMembers() { ... }
 * ```
 */
export const OrgScoped = () => SetMetadata(ORG_SCOPED_KEY, true);
