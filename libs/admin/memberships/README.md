# @libs/admin/memberships

Admin service for managing members across any organization.

## Responsibility

`AdminMembershipsService` delegates to `@libs/memberships` for writes (invite, change role, remove)
and owns a read-optimized repository for listing members with pagination.

## Operations

| Method                                            | Description                                                   |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `listMembers(orgId, pagination)`                  | Paginated list of members with user profile fields            |
| `inviteMember(orgId, input, inviterUserId)`       | Invite a user to any org (delegates to `InviteMemberService`) |
| `changeRole(orgId, memberId, input, actorUserId)` | Change role of any member (delegates to `MembershipsService`) |
| `removeMember(orgId, memberId, actorUserId)`      | Remove a member (delegates to `RemoveMemberService`)          |

## Member item shape

```ts
{
  id, orgId, userId, role, status, joinedAt,
  user: { id, email, firstName, lastName, pictureUrl }
}
```

## Exports

| Symbol                        | Description                    |
| ----------------------------- | ------------------------------ |
| `AdminMembershipsModule`      | Import in the admin app module |
| `AdminMembershipsService`     | Application service            |
| `AdminMemberItem`             | DTO type                       |
| `PaginatedAdminMembersResult` | Paginated list DTO             |

## Pattern

Pattern B (2-layer). Repository: `AdminMembershipsRepository` (read-only, never exported).
