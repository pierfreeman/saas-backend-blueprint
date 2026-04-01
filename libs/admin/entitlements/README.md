# @libs/admin/entitlements

Admin service for reading and invalidating plan entitlements for any organization.

## Responsibility

`AdminEntitlementsService` is a thin façade over `FeatureFlagsService` (`@libs/feature-flags`).
It allows system admins to inspect the current Redis-cached entitlement state for any org
and force-invalidate the cache when needed (e.g. after a manual plan change).

## Operations

| Method                   | Description                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `getEntitlements(orgId)` | Returns `OrganizationEntitlements` (plan flags, seat/storage limits)              |
| `invalidateCache(orgId)` | Flushes the Redis entitlement cache for the org; next request re-computes from DB |

## Exports

| Symbol                     | Description                            |
| -------------------------- | -------------------------------------- |
| `AdminEntitlementsModule`  | Import in the admin app module         |
| `AdminEntitlementsService` | Application service                    |
| `OrganizationEntitlements` | Re-exported from `@libs/feature-flags` |

## Pattern

Pattern E (flat — single module + service, no repository).
