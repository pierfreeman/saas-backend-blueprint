# Security Rules

Security patterns enforced across this multi-tenant SaaS backend.

---

## Authentication (Auth0)

- **Auth0 RS256 JWT** validation via JWKS endpoint (cached, rate-limited 5 req/min).
- **`JwtAuthGuard`** validates JWT on all protected endpoints — attaches `{ sub, email }` to `request.user`.
- **Never decode or store JWTs manually** — Auth0 SDK handles validation.
- **First-call user upsert** — `GET /auth/me` creates/updates user record + personal org + OWNER membership.
- **M2M credentials** (for email invites) stored in env vars only — never hardcoded.

---

## Authorization (RBAC)

- **Static role hierarchy**: `OWNER > ADMIN > MEMBER > READ_ONLY`.
- **9 permissions**: `org.manage`, `org.billing.manage`, `org.members.invite`, `org.members.remove`, `org.members.role.update`, `org.read`, `audit.read`, `analytics.view`, `analytics.export`.
- **Guard pipeline**: `JwtAuthGuard → OrgContextGuard → RBACGuard`.
- **`@RequirePermissions()`** — resolves via `PermissionResolverService`, Redis-cached (TTL 10 min).
- **`@RequireRole()`** — fast path, reads `request.membership.role` directly (no Redis).
- **Cache invalidation** — RBAC cache cleared after membership create/update/delete.
- **`@OrgScoped()`** — triggers `OrgContextGuard` to extract + validate orgId and inject tenant context.

---

## Multi-tenancy isolation

- **`x-org-id` / `x-tenant-id` header** — extracted by `OrgContextGuard`.
- **OrgId source priority**: params → query → body → header.
- **Membership verification** — guard validates the user has a membership in the target org.
- **`request.tenantContext`** — injected by guard, available to all downstream services.
- **All queries must be org-scoped** — services filter by `orgId` parameter.
- **Backend enforces org scoping** — even if the frontend sends wrong org context.

---

## Data handling

- **Two-database design** — business DB + legal audit DB, deliberately isolated.
- **Legal audit is append-only** — `AuditEvent` records can never be updated or deleted.
- **Dual audit on every CUD** — `activityLog.logActivity()` + `legalAudit.recordEvent()`.
- **Prisma clients are gitignored** — generated at `prisma generate` time, never committed.
- **No secrets in code** — all credentials in env vars, validated by Joi on startup.

---

## Input validation

- **Global `ValidationPipe`** — `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- **`class-validator`** decorators on all DTO properties.
- **Unknown properties are stripped** — clients cannot inject extra fields.
- **Payload sanitization middleware** — runs before guards.
- **Request size limits** — enforced per-route via middleware.

---

## Rate limiting and brute-force protection

- **Per-IP rate limiting** — configurable via `RATE_LIMIT_MAX_PER_IP` (default: 100/window).
- **Brute-force lockout** — `BRUTE_FORCE_MAX_ATTEMPTS` auth failures before IP lockout.
- **IP allowlist/denylist** — configurable via env vars.
- **CORS** — `CORS_ALLOWED_ORIGINS` required in production (comma-separated).
- **Helmet** — security headers (CSP, HSTS, etc.).
- **CSRF** — protection enabled for state-changing operations.

---

## File storage security

- **Presigned URLs** — S3 upload/download via time-limited signed URLs.
- **Per-org isolation** — S3 key prefix: `{orgId}/{fileId}`.
- **Quota enforcement** — `UploadPolicyService` checks org storage limits before issuing upload URLs.
- **Cleanup scheduler** — orphaned/expired files are periodically cleaned up.

---

## Stripe / billing security

- **Webhook signature verification** — `STRIPE_WEBHOOK_SECRET` validates all incoming Stripe webhooks.
- **Idempotent webhook processing** — duplicate events are safely ignored.
- **No Stripe secrets in client code** — all Stripe operations are server-side.

---

## GDPR compliance

- **Org deletion** — configurable retention periods, async worker execution, legal audit preservation.
- **Org export** — async JSON+gzip export, presigned download URLs (24h expiry), automatic cleanup.
- **Legal audit trail survives org deletion** — deletion records remain in the legal DB.
- **Right to data portability** — export endpoint provides all org data in machine-readable format.

---

## Forbidden patterns

| Pattern                                     | Risk                                       |
| ------------------------------------------- | ------------------------------------------ |
| Manual JWT decode/storage                   | Token leakage, validation bypass           |
| Hardcoded secrets or API keys               | Credential exposure in source control      |
| Prisma calls outside repositories           | Bypasses audit trail, breaks encapsulation |
| Missing org-scope on queries                | Cross-tenant data leakage                  |
| Skipping dual audit on CUD operations       | Compliance violation                       |
| Direct Stripe API calls outside billing lib | Bypasses webhook idempotency, audit trail  |
| Non-whitelisted DTO properties              | Mass assignment / injection                |
| Missing `@OrgScoped()` on org endpoints     | Tenant context not injected                |
