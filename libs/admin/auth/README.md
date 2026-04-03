# @libs/admin/auth

System-admin authentication gate for the backoffice portal.

## Responsibility

Provides the `SystemAdminGuard` and the `CurrentAdminUserId` parameter decorator.
Every admin controller must apply both `JwtAuthGuard` (from `@libs/common`) and `SystemAdminGuard`.

## Guard pipeline

```
JwtAuthGuard → SystemAdminGuard
```

`SystemAdminGuard` resolves the caller's DB `User` record by `auth0Id` and asserts `isSystemAdmin === true`.
If the user is not found → `401 Unauthorized`. If found but not a system admin → `403 Forbidden`.

## Exports

| Symbol               | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `AdminAuthModule`    | Import in any admin feature module                               |
| `SystemAdminGuard`   | `CanActivate` guard — combine with `JwtAuthGuard`                |
| `CurrentAdminUserId` | Param decorator — extracts `request.user.dbUserId` (the DB UUID) |
| `AdminRequest`       | Express `Request` extension interface used internally            |

## Usage

```ts
@Controller('admin/organizations')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@ApiBearerAuth()
export class AdminOrganizationsController {
  @Get()
  list(@Query() query: ListOrgsQueryDto) { ... }

  @Post(':orgId/billing/portal')
  portal(
    @Param('orgId') orgId: string,
    @CurrentAdminUserId() adminUserId: string,
  ) { ... }
}
```

## Promoting users

The `isSystemAdmin` flag is only set via the CLI script — never by the login flow:

```sh
node scripts/promote-admin.mjs --email user@example.com          # promote
node scripts/promote-admin.mjs --email user@example.com --revoke # demote
```

## Pattern

Pattern D (cross-cutting) — guard + decorator only, no domain logic.
