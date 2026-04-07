# @libs/admin/organizations

Admin service for listing all organizations and viewing a Customer 360 detail page.

## Responsibility

`AdminOrganizationsService` provides system-admin views across all organizations,
bypassing the tenant isolation enforced for regular users.

## Operations

| Method                                              | Description                                                                                                                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `listOrganizations(filters, pagination)`            | Paginated org list — search by name, filter by `OrgStatus`, sort by `createdAt` DESC                                                                                                                        |
| `getOrganizationDetail(orgId)`                      | Customer 360 — billing snapshot, membership count, recent activity (last 5), plan entitlements                                                                                                              |
| `searchOrganizations(query)`                        | Lightweight name search returning id + name pairs (used by dropdowns and autocomplete)                                                                                                                      |
| `provisionOrganization(dto, adminId)`               | Enterprise provisioning: create org → optionally assign plan → invite owner via `InviteMemberService` → dual audit (activity + legal)                                                                       |
| `setOrgStatus(orgId, status, reason, actorAdminId)` | Suspend or reactivate an organization. Invalidates the entitlements cache immediately so suspended orgs stop receiving entitlement responses. Dual audit (activity + legal) with actor and reason recorded. |
| `requestExport(orgId, actorAdminId)`                | Delegates to `OrgExportService.requestExport()`. Returns `{ exportId }`. Creates an `OrgExport` record + job, emits `org.export.requested` event for `worker-a` to process.                                 |
| `listExports(orgId, limit, offset)`                 | Returns paginated `{ items, total, limit, offset }` of `OrgExport` records. `fileSize` is serialized to `string                                                                                             | null` (BigInt safe for JSON). |
| `getExport(exportId, orgId)`                        | Returns a single `OrgExport` record, `fileSize` serialized to `string                                                                                                                                       | null`.                        |

## Org detail shape

```ts
{
  id, name, status, billingStatus, planId, membersCount, createdAt,
  stripeCustomerId, subscriptionId, subscriptionPeriodEnd, cancelAtPeriodEnd,
  recentActivity: ActivityLogRecord[],   // last 5 events
  entitlements: OrganizationEntitlements, // Redis-cached plan flags
}
```

## Exports

| Symbol                              | Description                    |
| ----------------------------------- | ------------------------------ |
| `AdminOrganizationsModule`          | Import in the admin app module |
| `AdminOrganizationsService`         | Application service            |
| `AdminOrganizationListItem`         | DTO type                       |
| `AdminOrganizationDetail`           | DTO type                       |
| `PaginatedAdminOrganizationsResult` | Paginated list DTO             |
| `ListOrganizationsFilters`          | Filter params DTO              |
| `ListOrganizationsPagination`       | Pagination params DTO          |

## Guard impact

When an org is suspended, `OrgContextGuard` (in `libs/rbac`) fetches the org status after
validating membership and throws a `403 ForbiddenException('Organization is suspended')`.
This blocks all tenant-API requests for that org without any per-controller change.

## Pattern

Pattern B (2-layer: application + infrastructure). Repository: `AdminOrganizationsRepository`
(never exported).
