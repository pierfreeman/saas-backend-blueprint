# admin-api

**Admin backoffice REST API** — NestJS app on `port 3001`.
Serves the standalone `apps/admin` (port 4203) portal.
Completely isolated from the tenant API (`apps/api`, port 3000): separate Auth0 application, separate JWT audience, separate admin user table.

---

## Authentication

JWT validation via **`AdminJwtAuthGuard`** using Auth0 RS256 JWKS.

| Concern      | Tenant API (`apps/api`)    | Admin API (`apps/admin-api`)           |
| ------------ | -------------------------- | -------------------------------------- |
| Auth0 app    | Tenant SPA app             | Admin SPA app (separate)               |
| JWT audience | `https://api.saas-api.com` | `https://admin-api.saas-api.com`       |
| User DB      | `users` (business DB)      | `admin_users` (legal DB)               |
| Guard        | `JwtAuthGuard`             | `AdminJwtAuthGuard`                    |
| User upsert  | `AuthService.syncUser()`   | `AdminIdentityService.syncAdminUser()` |

An admin user is created automatically in `admin_users` on first successful login via `GET /admin/me`.

---

## Guard pipeline

```
AdminJwtAuthGuard → controller
```

`AdminJwtAuthGuard` validates the JWT and injects `request.user.adminUserId` (the `admin_users.id`).
Use `@CurrentAdminUserId()` in controllers to access it.

There is no `OrgContextGuard` or RBAC guard — all endpoints require only a valid admin JWT.

---

## API endpoints

All routes are prefixed `/admin` and require `Authorization: Bearer <admin-jwt>`.
Swagger docs: `http://localhost:3001/docs`

| Controller                     | Prefix                                    | Description                                                     |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| `AdminMeController`            | `GET /admin/me`                           | Upsert admin user on login; return profile                      |
| `AdminOrganizationsController` | `/admin/organizations`                    | Org list (paginated), detail, status patch, provision           |
| `AdminMembershipsController`   | `/admin/organizations/:orgId/memberships` | Invite, list, role change, remove                               |
| `AdminBillingController`       | `/admin/billing`                          | Subscription overview, change plan, extend trial, Stripe portal |
| `AdminEntitlementsController`  | `/admin/entitlements`                     | Resolved entitlements, per-org overrides (set/delete)           |
| `AdminJobsController`          | `/admin/jobs`                             | Job list per org, pagination                                    |
| `AdminActivityLogController`   | `/admin/activity-log`                     | Cross-tenant + org-scoped activity log                          |
| `AdminFeatureFlagsController`  | `/admin/feature-flags`                    | Billing cache invalidation                                      |

---

## Libraries used

| Library                     | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `@libs/admin/auth`          | `AdminAuthModule`, `AdminJwtAuthGuard`, `@CurrentAdminUserId()` |
| `@libs/admin/identity`      | `AdminIdentityService`, `admin_users` upsert+lookup             |
| `@libs/admin/organizations` | Org CRUD, status management, provisioning                       |
| `@libs/admin/memberships`   | Invite, role change, remove for cross-tenant ops                |
| `@libs/admin/billing`       | Stripe overview, plan change, trial extension                   |
| `@libs/admin/entitlements`  | Resolved entitlements + per-org overrides                       |
| `@libs/admin/jobs`          | Job list per org                                                |
| `@libs/admin/activity-log`  | Cross-tenant activity log                                       |
| `@libs/config`              | `adminAuthConfig` — ADMIN*AUTH0*\* env vars                     |
| `@libs/security`            | Helmet, CORS, rate limiting, CSRF                               |
| `@libs/observability`       | Structured logging, Sentry, request interceptors                |
| `@libs/prisma-business`     | Business DB (org, membership, billing data)                     |
| `@libs/prisma-legal`        | Legal DB (`admin_users` table)                                  |

---

## Environment variables

| Variable               | Description                                      | Example                          |
| ---------------------- | ------------------------------------------------ | -------------------------------- |
| `ADMIN_API_PORT`       | Listening port                                   | `3001`                           |
| `DATABASE_URL`         | Business DB connection string                    | `postgresql://...`               |
| `LEGAL_DATABASE_URL`   | Legal DB connection string (holds `admin_users`) | `postgresql://...`               |
| `REDIS_URL`            | Redis connection string                          | `redis://localhost:6379`         |
| `ADMIN_AUTH0_DOMAIN`   | Auth0 domain for admin JWT validation            | `dev-xxx.eu.auth0.com`           |
| `ADMIN_AUTH0_AUDIENCE` | Expected JWT audience                            | `https://admin-api.saas-api.com` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins                  | `http://localhost:4203`          |
| `SENTRY_DSN`           | Sentry DSN (optional)                            |                                  |

---

## Development

```sh
# From saas-backend-blueprint root — requires Docker infra running
npx nx serve admin-api        # http://localhost:3001
                               # Swagger: http://localhost:3001/docs

# Typecheck
npx nx typecheck admin-api

# Unit tests
npx nx test admin-api

# Integration tests (requires test containers)
npm run test:infra:up
npm run test:migrate
npx nx test admin-api-e2e
```

---

## File structure

```
src/
  main.ts                  — bootstrap: Helmet, CORS, ValidationPipe, Swagger, Sentry
  app/
    app.module.ts           — AdminApiAppModule: imports all lib modules + AdminModule
    admin/
      admin.module.ts       — wires all admin controllers
      admin.dto.ts          — shared DTOs (pagination, etc.)
      admin-me.controller.ts
      admin-organizations.controller.ts
      admin-memberships.controller.ts
      admin-billing.controller.ts
      admin-entitlements.controller.ts
      admin-jobs.controller.ts
      admin-activity-log.controller.ts
      admin-feature-flags.controller.ts
      dto/
        admin.dto.ts
```
