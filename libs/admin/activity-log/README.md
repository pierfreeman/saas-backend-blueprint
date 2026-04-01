# @libs/admin/activity-log

Admin service for querying activity logs — both per-org and cross-org.

## Responsibility

`AdminActivityLogService` provides two query modes:

1. **Per-org**: delegates to `ActivityLogService.findByOrg()` (same data path as the tenant API).
2. **Cross-org**: queries all organizations with optional filters via `AdminActivityLogRepository`.

## Operations

| Method                         | Description                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `getOrgActivity(orgId, query)` | Paginated activity log for a single org (delegates to `@libs/activity-log`)         |
| `getAllActivity(query)`        | Cross-org paginated log — optional `orgId`, `action` prefix, `from`/`to` date range |

## Query parameters

```ts
// Per-org
{ action?: string; from?: string; to?: string; limit?: number; offset?: number }

// Cross-org (adds optional orgId scoping)
{ orgId?: string; action?: string; from?: string; to?: string; limit?: number; offset?: number }
```

## Exports

| Symbol                         | Description                    |
| ------------------------------ | ------------------------------ |
| `AdminActivityLogModule`       | Import in the admin app module |
| `AdminActivityLogService`      | Application service            |
| `PaginatedAdminActivityResult` | Paginated result DTO           |

## Pattern

Pattern B (2-layer). Repository: `AdminActivityLogRepository` (cross-org queries, never exported).
