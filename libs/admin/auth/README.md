# @libs/admin/auth

Authentication gate for the admin-api backoffice portal.

## Responsibility

Provides `AdminJwtAuthGuard` (the active guard for all admin controllers), `SystemAdminGuard` (legacy — kept for backward compatibility during migration), and `CurrentAdminUserId` parameter decorator.

Every admin controller must apply `AdminJwtAuthGuard`:

```ts
@Controller('admin/organizations')
@UseGuards(AdminJwtAuthGuard)
@ApiBearerAuth()
export class AdminOrganizationsController { ... }
```

## Guard pipeline

```
AdminJwtAuthGuard   (Passport 'admin-jwt' strategy — validates ADMIN_AUTH0_* JWT)
  └─ AdminJwtStrategy.validate()
        └─ AdminIdentityService.syncAdminUser()  ← upserts AdminUser in legal DB
        └─ attaches { sub, email, adminUserId } to request.user
```

`AdminJwtAuthGuard` is backed by the `AdminJwtStrategy` from `@libs/admin/identity`. It validates tokens issued by the **admin Auth0 SPA app** (`SaaS Admin Portal`) against the **admin Auth0 API** audience (`ADMIN_AUTH0_AUDIENCE`) — completely separate from the tenant JWT flow.

## Exports

| Symbol | Description |
|---|---|
| `AdminAuthModule` | Import in any admin feature module |
| `AdminJwtAuthGuard` | ✅ Primary guard — use on all admin controllers |
| `SystemAdminGuard` | ⚠️ Legacy guard (checks `users.isSystemAdmin`) — kept for backward compat during Phase C cleanup |
| `CurrentAdminUserId` | Param decorator — extracts the `adminUserId` UUID from the request |

## Usage

```ts
import { AdminJwtAuthGuard, CurrentAdminUserId } from '@libs/admin/auth';

@Controller('admin/organizations')
@UseGuards(AdminJwtAuthGuard)
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

## Admin user provisioning

Admin users cannot self-register. They are created via the CLI script:

```sh
node scripts/manage-admin-user.mjs --create --email admin@example.com --name "Alice"
node scripts/manage-admin-user.mjs --list
node scripts/manage-admin-user.mjs --reset-password --email admin@example.com
node scripts/manage-admin-user.mjs --disable --email admin@example.com
```

For the one-time migration from the legacy `isSystemAdmin` flag:

```sh
node scripts/migrate-admin-users.mjs --dry-run
node scripts/migrate-admin-users.mjs
```

## Legacy: `SystemAdminGuard`

`SystemAdminGuard` (combined with `JwtAuthGuard` from `@libs/common`) was the original access gate — it checked `users.isSystemAdmin === true` in the tenant DB. It is retained until Phase C cleanup removes the `isSystemAdmin` column. Do not use it on new controllers.

## Pattern

Pattern D (cross-cutting) — guards + decorator + module wiring only, no domain logic.
Domain logic (user sync, profile lookup) lives in `@libs/admin/identity`.

