import { SetMetadata } from '@nestjs/common';

export const ALLOW_SUSPENDED_KEY = 'rbac:allow-suspended';

/**
 * Allow a route to be accessed even when the organization status is SUSPENDED.
 *
 * By default, `OrgContextGuard` blocks all requests from suspended organizations.
 * Apply this decorator to GDPR-sensitive endpoints (e.g. data export, billing portal)
 * where suspended organizations must retain access rights regardless of their status.
 *
 * @example
 * ```typescript
 * @Post(':id/export')
 * @OrgScoped()
 * @AllowSuspended()
 * @UseGuards(OrgContextGuard, RBACGuard)
 * requestExport() { ... }
 * ```
 */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
