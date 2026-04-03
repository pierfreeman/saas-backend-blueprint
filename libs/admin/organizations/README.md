# @libs/admin/organizations

Admin service for listing all organizations and viewing a Customer 360 detail page.

## Responsibility

`AdminOrganizationsService` provides system-admin views across all organizations,
bypassing the tenant isolation enforced for regular users.

## Operations

| Method                                   | Description                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `listOrganizations(filters, pagination)` | Paginated org list — search by name, filter by `OrgStatus`, sort by `createdAt` DESC                                                  |
| `getOrganizationDetail(orgId)`           | Customer 360 — billing snapshot, membership count, recent activity (last 5), plan entitlements                                        |
| `searchOrganizations(query)`             | Lightweight name search returning id + name pairs (used by dropdowns and autocomplete)                                                |
| `provisionOrganization(dto, adminId)`    | Enterprise provisioning: create org → optionally assign plan → invite owner via `InviteMemberService` → dual audit (activity + legal) |

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

## Pattern

Pattern B (2-layer: application + infrastructure). Repository: `AdminOrganizationsRepository`
(read-only, never exported).
