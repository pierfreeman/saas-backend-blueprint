# @libs/admin/identity

Admin identity management — Auth0 JWT strategy, admin user sync, and profile service for the backoffice portal.

## Responsibility

Provides the Passport JWT strategy scoped to the **admin Auth0 application** and the repository + service that keep `admin_users` (legal DB) in sync on every login.

This library is the backend implementation of the **Separate Admin User Base** feature. Admin users authenticate via a dedicated Auth0 SPA app (`SaaS Admin Portal`) against a separate user database connection (`Admin-Users-DB`). Their identity is stored in the **legal audit DB** — completely isolated from the tenant `users` table in the business DB.

## Architecture

```
AdminJwtStrategy (Passport 'admin-jwt')
  └─ validates JWT audience + issuer from ADMIN_AUTH0_* env vars
  └─ calls AdminIdentityService.syncAdminUser()
        └─ upserts AdminUser in legal DB via AdminUserRepository
        └─ returns { sub, email, adminUserId }

AdminIdentityService   ← application service (exported)
AdminUserRepository    ← infrastructure (not exported)
AdminJwtStrategy       ← Passport strategy (registered internally)
```

## Pattern

Pattern B (2-layer: application + infrastructure), scoped to the admin namespace.

## Auth0 Setup Required

This library requires three Auth0 resources:

| Resource            | Type                    | Purpose                                        |
| ------------------- | ----------------------- | ---------------------------------------------- |
| `SaaS Admin Portal` | Single Page Application | Issues JWTs consumed by this strategy          |
| `SaaS Admin API`    | API (Resource Server)   | Sets the JWT audience (`ADMIN_AUTH0_AUDIENCE`) |
| `Admin-Users-DB`    | Database Connection     | Admin-only user pool (signup disabled)         |

And one Auth0 **Post-Login Action** named **"Enrich Admin Access Token"** registered in the **Login flow** that sets the email custom claim:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  const ADMIN_CLIENT_ID = event.secrets.ADMIN_CLIENT_ID;
  if (event.client.client_id !== ADMIN_CLIENT_ID) return;

  const namespace = event.secrets.CLAIMS_NAMESPACE; // https://admin.saas-api.com/
  api.accessToken.setCustomClaim(`${namespace}email`, event.user.email);
  if (event.user.name) {
    api.accessToken.setCustomClaim(`${namespace}name`, event.user.name);
  }
};
```

**Action secrets:** `ADMIN_CLIENT_ID` (Client ID of `SaaS Admin Portal`), `CLAIMS_NAMESPACE` (`https://admin.saas-api.com/` — must match `ADMIN_AUTH0_CLAIMS_NAMESPACE` env var).

## Environment Variables

| Variable                       | Required | Description                                                   |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| `ADMIN_AUTH0_DOMAIN`           | ✅       | Auth0 tenant domain (e.g. `dev-xxx.eu.auth0.com`)             |
| `ADMIN_AUTH0_AUDIENCE`         | ✅       | Admin API identifier (e.g. `https://admin-api.saas-api.com`)  |
| `ADMIN_AUTH0_CLAIMS_NAMESPACE` | optional | Custom claims prefix (default: `https://admin.saas-api.com/`) |

## Exports

| Symbol                 | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `AdminIdentityModule`  | Import in `AdminAuthModule` or any admin feature module that needs it     |
| `AdminIdentityService` | Application service — `syncAdminUser()`, `findByIdOrThrow()`, `findAll()` |
| `AdminUserProfile`     | Shape returned by `syncAdminUser()` and `findByIdOrThrow()`               |

`AdminUserRepository` and `AdminJwtStrategy` are **not exported** — they are internal infrastructure.

## Usage

The module is imported by `AdminAuthModule` (which provides `AdminJwtAuthGuard`). You rarely need to import it directly. If you need the service standalone:

```ts
@Module({
  imports: [AdminIdentityModule],
  controllers: [AdminMeController],
})
export class AdminModule {}
```

```ts
@Controller('admin')
@UseGuards(AdminJwtAuthGuard)
export class AdminMeController {
  constructor(private readonly adminIdentityService: AdminIdentityService) {}

  @Get('me')
  getMe(@CurrentAdminUserId() adminUserId: string) {
    return this.adminIdentityService.findByIdOrThrow(adminUserId);
  }
}
```

## User Management Scripts

Admin users cannot self-register. They are provisioned via CLI:

```sh
# Create a new admin user in Auth0 Admin-Users-DB + legal DB
node scripts/manage-admin-user.mjs --create --email admin@example.com --name "Alice"

# Disable an admin (blocks Auth0 login + marks disabled in legal DB)
node scripts/manage-admin-user.mjs --disable --email admin@example.com

# Trigger a password reset email
node scripts/manage-admin-user.mjs --reset-password --email admin@example.com

# List all admin users from legal DB
node scripts/manage-admin-user.mjs --list
```

Requires `ADMIN_AUTH0_DOMAIN`, `ADMIN_AUTH0_M2M_CLIENT_ID`, `ADMIN_AUTH0_M2M_CLIENT_SECRET` in `.env`.

## Future: Google Workspace Login (TODO)

> Current implementation uses `Admin-Users-DB` (email/password). A future iteration should switch to Google Workspace SSO restricted to the company domain, keeping `admin_users` as an explicit allowlist.

Required changes in this library:

1. **`admin_users` schema** — make `auth0Id` nullable (`String?`). Pre-provisioned rows have `auth0Id = null`; it is set on first login.
2. **`AdminUserRepository`** — add `findByEmail(email)` and `linkAuth0Id(id, auth0Id)` methods to support first-login linking.
3. **`AdminIdentityService.syncAdminUser(auth0Id, email)`** — change the upsert logic:
   ```
   1. findByAuth0Id(auth0Id) → found → return profile (normal login)
   2. findByEmail(email) → found + auth0Id is null → linkAuth0Id → return profile (first login)
   3. not found → throw UnauthorizedException  ← the allowlist gate
   ```
4. **`manage-admin-user.mjs --create`** — remove Auth0 Management API call; write only the `admin_users` legal DB record.

Auth0 Dashboard changes (no backend code):

- Enable `google-oauth2` connection on `SaaS Admin Portal`
- Add `Restrict Admin to Company Domain` Action (domain check before `syncAdminUser` is reached)
- Disable `Admin-Users-DB` on `SaaS Admin Portal`
- Remove `Enforce MFA for Admin` Action (enforce via Google Workspace Admin Console instead)

See `saas-context-docs/docs/features/admin-backoffice-portal/separate-admin-user-base.md` for full design.

---

## One-time Migration Script

To migrate existing `isSystemAdmin=true` users from the tenant DB to the new admin identity system:

```sh
node scripts/migrate-admin-users.mjs --dry-run   # preview
node scripts/migrate-admin-users.mjs             # execute
```

## Database

`AdminUser` is stored in the **legal audit DB** (`prisma-legal/schema.prisma`):

```prisma
model AdminUser {
  id          String   @id @default(cuid())
  auth0Id     String   @unique
  email       String
  displayName String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("admin_users")
  @@index([email])
}
```

After changing this model, run:

```sh
npx prisma migrate dev --config prisma.config.legal.ts --name <migration-name>
```
