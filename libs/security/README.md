# Security Architecture

## Overview

This document describes the defence-in-depth security infrastructure for the SaaS Backend Blueprint — a production-grade multi-tenant NestJS Nx monorepo.

All security components live in the shared `@libs/security` library and are applied globally to `apps/api`. They remain active even when a WAF or cloud firewall is in front of the application.

---

## Architecture Diagram

```
Internet
   │
   ▼
[ WAF / CDN / Load Balancer ]      ← optional cloud-layer defence
   │
   ▼
[ apps/api — NestJS HTTP Server ]
   │
   ├── Helmet middleware            ← HTTP security headers (CSP, HSTS, …)
   ├── CORS (app.enableCors)        ← allowlist-based origin enforcement
   │
   ├── IpFilterGuard               ← allowlist / denylist
   ├── BruteForceGuard             ← per-IP lockout check
   │
   ├── RateLimitInterceptor        ← per-IP, per-user, per-tenant (Redis)
   ├── CsrfInterceptor             ← double-submit cookie (optional)
   ├── SecurityAuditInterceptor    ← auth-failure tracking + audit log
   │
   ├── JwtAuthGuard                ← Auth0 RS256 JWT validation (JWKS)
   ├── OrgContextGuard             ← tenant membership verification
   └── RBACGuard                   ← role / permission enforcement
          │
          ▼
   [ Controller / Service ]
          │
          ▼
   [ ActivityLog / LegalAudit DB ] ← compliance event store
```

---

## Component Reference

### 1. HTTP Security Headers — `HelmetMiddleware`

Applied in `main.ts` via `app.use(helmet(...))` before any NestJS middleware/guard.

| Header | Value | Purpose |
|---|---|---|
| `Content-Security-Policy` | default-src 'self'; frame-ancestors 'none'; … | Restricts resource origins; prevents XSS |
| `Strict-Transport-Security` | max-age=31536000; includeSubDomains; preload | Enforces HTTPS (production only) |
| `X-Content-Type-Options` | nosniff | Prevents MIME-type sniffing |
| `X-Frame-Options` | DENY | Blocks clickjacking via iframes |
| `Referrer-Policy` | strict-origin-when-cross-origin | Limits referrer information leakage |
| `Cross-Origin-Embedder-Policy` | require-corp | Enables browser security isolation |
| `Cross-Origin-Opener-Policy` | same-origin | Prevents cross-origin window access |
| `X-XSS-Protection` | 0 | Disabled — CSP is the modern replacement |
| `X-Powered-By` | *removed* | Hides server fingerprint |

**Configuration:** No ENV vars required — always-on.

---

### 2. CORS — `cors.middleware.ts` + `app.enableCors()`

Applied at the framework level in `main.ts`. Reads allowed origins from config.

| ENV var | Default | Description |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Comma-separated list of allowed origins |
| `CORS_CREDENTIALS` | `true` | Whether to allow credentialed requests |

**Development mode:** When `CORS_ALLOWED_ORIGINS` is empty and `NODE_ENV != production`, all origins are allowed. Set this to your frontend origins in staging/production.

**Example:**
```env
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CORS_CREDENTIALS=true
```

---

### 3. Rate Limiting — `RateLimitInterceptor` + `RateLimitService`

Distributed fixed-window rate limiter backed by Redis (DB=2).

**Three independent axes:**
1. **Per IP** — coarsest protection, catches anonymous floods
2. **Per authenticated user** — applied after JWT validation
3. **Per tenant/org** — applied when `x-org-id` context is present

**Response headers on every request:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1748500000
```

**On limit exceeded — HTTP 429:**
```json
{
  "statusCode": 429,
  "message": "Rate limit exceeded. Please slow down.",
  "retryAfter": 45
}
```

| ENV var | Default | Description |
|---|---|---|
| `RATE_LIMIT_TTL` | `60` | Window size in seconds |
| `RATE_LIMIT_MAX_PER_IP` | `100` | Max requests/window per IP |
| `RATE_LIMIT_MAX_PER_USER` | `200` | Max requests/window per user |
| `RATE_LIMIT_MAX_PER_TENANT` | `1000` | Max requests/window per tenant |

**Skip for specific routes:**
```typescript
@SkipRateLimit()
@Get('health')
async healthCheck() { ... }
```

**Failure mode:** Fails open. If Redis is unavailable, all requests are allowed to prevent a Redis outage from taking down the API.

---

### 4. Brute-Force Protection — `BruteForceGuard` + `BruteForceService`

Tracks failed authentication attempts per IP in Redis (DB=2).

**Flow:**
1. `BruteForceGuard` checks for an active lockout **before** processing the request.
2. `SecurityAuditInterceptor` catches 401 responses and increments the failure counter.
3. On successful authentication, the counter is reset via `resetAttempts()`.

**Lockout:**
- After `BRUTE_FORCE_MAX_ATTEMPTS` failed attempts, the IP is locked for `BRUTE_FORCE_LOCKOUT_TTL` seconds.
- Locked IPs receive HTTP 429 with `Retry-After` header.
- A `security.brute_force.locked` compliance event is written to the legal audit log.

| ENV var | Default | Description |
|---|---|---|
| `BRUTE_FORCE_MAX_ATTEMPTS` | `5` | Attempts before lockout |
| `BRUTE_FORCE_LOCKOUT_TTL` | `900` (15 min) | Lockout duration (seconds) |
| `BRUTE_FORCE_TRACKING_TTL` | `3600` (1 hour) | Counter TTL (seconds) |

**Apply to auth endpoints:**
```typescript
@UseGuards(BruteForceGuard, JwtAuthGuard)
@Post('login')
async login() { ... }
```

---

### 5. CSRF Protection — `CsrfInterceptor`

**Status: DISABLED by default.**

> Auth0 Bearer token authentication is inherently CSRF-safe. Browsers cannot set the `Authorization` header cross-origin, so CSRF attacks are structurally impossible for Bearer token flows. Enable this only if cookie-based authentication is added.

**Pattern:** Double-submit cookie.
- Safe requests (GET/HEAD/OPTIONS): Server sets a `__csrf` cookie.
- Mutating requests (POST/PUT/PATCH/DELETE): Client must echo the cookie value in `x-csrf-token` header. Any mismatch returns HTTP 403.
- Constant-time `timingSafeEqual` comparison prevents timing attacks.

| ENV var | Default | Description |
|---|---|---|
| `CSRF_PROTECTION_ENABLED` | `false` | Enable CSRF protection |
| `CSRF_COOKIE_NAME` | `__csrf` | Cookie name |
| `CSRF_HEADER_NAME` | `x-csrf-token` | Request header name |

**Skip for webhooks:**
```typescript
@SkipCsrf()
@Post('webhooks/stripe')
async stripeWebhook() { ... }
```

---

### 6. Input Validation / Sanitisation

Applied globally via `ValidationPipe` in `main.ts`:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,                      // Strip unknown properties
    forbidNonWhitelisted: true,          // 400 on unknown properties
    transform: true,                     // Coerce types automatically
    transformOptions: { enableImplicitConversion: true },
  }),
);
```

All DTOs use `class-validator` decorators. Unknown/excess fields are stripped before reaching controllers, preventing parameter pollution.

**SQL injection:** Prevented by Prisma's parameterised queries — no raw SQL interpolation.

**XSS:** CSP + input stripping via ValidationPipe whitelist.

---

### 7. WebSocket Security — `WsJwtGuard`

Validates Auth0 JWT tokens on socket.io connection handshake.

**Token sources (in priority order):**
1. `socket.handshake.auth.token` (preferred — socket.io v3+)
2. `socket.handshake.headers.authorization` (Bearer scheme)

**Validation:** Same RS256 JWKS endpoint as the REST API (`JwksClient` with caching).

**On success:** Decoded payload attached to `socket.data.user`.

**On failure:** `WsException('Unauthorized')` — socket.io disconnects the client.

**Apply to gateways:**
```typescript
@UseGuards(WsJwtGuard)
@WebSocketGateway({ namespace: '/notifications' })
export class NotificationsGateway { ... }
```

**WebSocket rate limiting:**

| ENV var | Default | Description |
|---|---|---|
| `WS_RATE_LIMIT_ENABLED` | `true` | Enable per-connection message limiting |
| `WS_RATE_LIMIT_MAX_MESSAGES_PER_MINUTE` | `60` | Max messages per connection per minute |

---

### 8. Security Audit Logging — `SecurityAuditInterceptor`

Cross-cutting interceptor that writes compliance events to the legal audit database (`@libs/legal-audit`).

**Events recorded:**

| Event type | Trigger | Data captured |
|---|---|---|
| `security.auth.failed` | 401 response | IP, path, method, attempt count, locked status |
| `security.brute_force.locked` | Lockout triggered | IP, path, attempt count |
| `security.brute_force.blocked` | Locked IP blocked | IP, path, lockout remaining |
| `security.rate_limit.exceeded` | 429 response | Axis (ip/user/tenant), identifier, path |
| `security.ip_filter.denied` | IP on denylist | IP, path, rule type |
| `security.ip_filter.not_allowed` | IP not on allowlist | IP, path, rule type |

**Compliance standards addressed:**
- ISO 27001:2022 A.8.15 — Logging (tamper-evident records)
- ISO 27001:2022 A.8.16 — Monitoring
- GDPR Art. 5(2) — Accountability

---

### 9. IP Allowlist / Denylist — `IpFilterGuard`

Optional enterprise feature for IP-level access control.

**Evaluation order:**
1. Denylist — always block listed IPs (403).
2. Allowlist — block all IPs **not** on the list (403), if enabled.

| ENV var | Default | Description |
|---|---|---|
| `IP_ALLOWLIST_ENABLED` | `false` | Enable allowlist mode |
| `IP_ALLOWLIST` | *(empty)* | Comma-separated allowed IPs |
| `IP_DENYLIST_ENABLED` | `false` | Enable denylist |
| `IP_DENYLIST` | *(empty)* | Comma-separated blocked IPs |

**Apply to admin routes:**
```typescript
@UseGuards(IpFilterGuard, JwtAuthGuard, OrgContextGuard, RBACGuard)
@RequireRole('OWNER')
@Get('admin/config')
async getConfig() { ... }
```

---

### 10. Auth0 JWT Integration

Auth0 JWT validation is handled by the existing `JwtAuthGuard` + `JwtStrategy` in `apps/api/src/app/auth/`.

- RS256 signature verified via JWKS endpoint (`AUTH0_DOMAIN`)
- Audience and issuer checked on every request
- JWKS keys cached (5-per-minute rate limit to protect Auth0)
- No custom JWT issuance or refresh — Auth0 is the sole token authority

**Guard pipeline for protected, org-scoped endpoints:**
```
JwtAuthGuard → OrgContextGuard → RBACGuard → Controller
```

---

## Environment Variables Summary

| Variable | Default | Required | Description |
|---|---|---|---|
| `AUTH0_DOMAIN` | — | ✅ | Auth0 tenant domain |
| `AUTH0_AUDIENCE` | — | ✅ | Auth0 API audience |
| `CORS_ALLOWED_ORIGINS` | *(empty)* | Prod ✅ | Comma-separated allowed origins |
| `CORS_CREDENTIALS` | `true` | — | Allow credentialed CORS requests |
| `RATE_LIMIT_TTL` | `60` | — | Rate-limit window (seconds) |
| `RATE_LIMIT_MAX_PER_IP` | `100` | — | Max requests/window/IP |
| `RATE_LIMIT_MAX_PER_USER` | `200` | — | Max requests/window/user |
| `RATE_LIMIT_MAX_PER_TENANT` | `1000` | — | Max requests/window/tenant |
| `BRUTE_FORCE_MAX_ATTEMPTS` | `5` | — | Attempts before lockout |
| `BRUTE_FORCE_LOCKOUT_TTL` | `900` | — | Lockout duration (seconds) |
| `BRUTE_FORCE_TRACKING_TTL` | `3600` | — | Counter TTL (seconds) |
| `CSRF_PROTECTION_ENABLED` | `false` | — | Enable CSRF (cookie-auth only) |
| `CSRF_COOKIE_NAME` | `__csrf` | — | CSRF cookie name |
| `CSRF_HEADER_NAME` | `x-csrf-token` | — | CSRF request header |
| `IP_ALLOWLIST_ENABLED` | `false` | — | Enable IP allowlist |
| `IP_ALLOWLIST` | *(empty)* | — | Comma-separated allowed IPs |
| `IP_DENYLIST_ENABLED` | `false` | — | Enable IP denylist |
| `IP_DENYLIST` | *(empty)* | — | Comma-separated blocked IPs |
| `WS_RATE_LIMIT_ENABLED` | `true` | — | Enable WebSocket rate limiting |
| `WS_RATE_LIMIT_MAX_MESSAGES_PER_MINUTE` | `60` | — | Max WS messages/min |

---

## Environment-Specific Behaviour

| Feature | Development | Staging | Production |
|---|---|---|---|
| CORS | All origins allowed | Configured origins | Strict allowlist required |
| HSTS | Disabled | Enabled | Enabled (with preload) |
| CSP upgrade-insecure-requests | Off | Off | On |
| CSRF | Off | Configurable | Off (Bearer token auth) |
| Rate limiting | Active (relaxed) | Active | Active (strict) |
| Brute-force | Active | Active | Active (strict) |

---

## Known Limitations

1. **Rate-limit persistence:** Window counters are stored in Redis. A Redis restart during a window will reset the counters for that window, temporarily granting extra capacity. Use Redis persistence (`appendonly yes`) in production.

2. **IP spoofing:** `X-Forwarded-For` can be spoofed if the load balancer does not overwrite it. Ensure your infrastructure terminates external connections before they reach the API so that only the load balancer can set trusted proxy headers.

3. **JWKS caching:** JWKS keys are cached for up to 10 minutes in `WsJwtGuard` and handled by `jwks-rsa` in the REST JWT strategy. Token revocation via Auth0 will take effect after the cache TTL expires.

4. **Single lockout axis:** Brute-force protection locks by IP only. If attackers use rotating IPs (botnets, residential proxies), consider adding Auth0 Attack Protection (Anomaly Detection) as an additional layer.

5. **Worker apps:** `apps/worker-a` processes async SQS messages and does not handle HTTP traffic — no HTTP security middleware is applied there. Ensure IAM/SQS policies enforce access control at the cloud layer.

---

## Defence-in-Depth Layers

```
Layer 1 (Cloud)    : WAF / DDoS protection / CDN (CloudFront, Cloudflare)
Layer 2 (App infra): Security groups / VPC / NACLs
Layer 3 (App code) : Helmet + CORS + Rate limiting + Brute-force (this lib)
Layer 4 (Auth)     : Auth0 JWT validation + RBAC + Tenant scoping
Layer 5 (Data)     : Prisma parameterised queries + schema validation
Layer 6 (Audit)    : ActivityLog + LegalAudit immutable records
```

Each layer is independently enforced. Disabling any one layer (e.g. WAF) does not remove protection from the others.
