# Security Middleware Layer

Production-ready Security Middleware Layer for OWASP-aligned API protection in Multi-tenant SaaS Backend Blueprint.

## Overview

The security layer is implemented as a dedicated NestJS module and runs globally for HTTP routes.

Main goals:

- Reduce common API attack surface (injection, brute-force, abuse traffic)
- Keep existing JWT/RBAC/business logic untouched
- Emit structured security events for audit and observability
- Stay configurable via environment variables

## What Is Implemented

### 1) Rate Limiting (Redis-backed)

- Scope: endpoint + method + IP + user identity (if available)
- Storage: Redis (cluster-safe)
- Behavior: blocks excess requests with `429 Too Many Requests`
- Adds suspicious score for abusive patterns

Implemented in:

- `src/modules/security/middleware/rate-limit.middleware.ts`
- `src/modules/security/services/attack-detection.service.ts`

### 2) Brute-Force Protection

- Scope: login/auth endpoints
- Tracking: per IP + login identifier (`email`/`username`/`sub`)
- Behavior: temporary block after max failed attempts
- Return code: `429 Too Many Requests` when blocked

Implemented in:

- `src/modules/security/middleware/brute-force-protection.middleware.ts`
- `src/modules/security/services/attack-detection.service.ts`

### 3) Payload Sanitization and Threat Detection

- Input surfaces: `body`, `query`, `params`
- Detects patterns related to:
  - SQL injection signatures
  - NoSQL operator abuse (`$where`, operator-like keys)
  - XSS payload fragments (`<script>`, `javascript:`, inline handlers)
- Behavior:
  - Sanitizes unsafe XSS content when possible
  - Blocks severe payload threats with `400 Bad Request`

Implemented in:

- `src/modules/security/middleware/payload-sanitization.middleware.ts`

### 4) Request Size Limits

- Protects from oversized payload abuse (DoS vector)
- Reads `content-length` and enforces configured max body size
- Return code: `413 Payload Too Large`

Implemented in:

- `src/modules/security/middleware/request-size-limit.middleware.ts`

### 5) CSRF Protection (Stateful Flows)

- Applies to cookie-based, state-changing requests (`POST/PUT/PATCH/DELETE`)
- Skips Bearer-only requests (stateless JWT API calls)
- Requires matching CSRF cookie and header token
- Return code: `403 Forbidden` when validation fails

Implemented in:

- `src/modules/security/middleware/csrf-protection.middleware.ts`

### 6) Secure Headers

When enabled, sets:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-XSS-Protection`
- `X-Content-Type-Options`
- `Referrer-Policy`

Implemented in:

- `src/modules/security/middleware/headers-security.middleware.ts`

### 7) Suspicious Activity Guard

Additional guard-level checks for malformed patterns and suspicious behavior.

- Detects malformed payload/query/path signals
- Registers suspicious score in Redis
- Can auto-throttle suspicious traffic
- Emits security events

Implemented in:

- `src/modules/security/guards/suspicious-activity.guard.ts`

### 8) Global Security Exception Handling

All security incidents are mapped through a dedicated exception filter.

- Standardized response payload for blocked requests
- Emits blocked request metadata as events

Implemented in:

- `src/modules/security/filters/security-exceptions.filter.ts`
- Registered in `src/main.ts`

## Audit and Security Events

Security events are emitted through the event bus and persisted by audit listeners.

Main events:

- `security.blocked`
- `security.suspicious`
- `security.alert.admin`

Audit integration:

- `src/modules/audit/audit.service.ts` listens and stores security audit entries

Captured metadata includes:

- `userId` (if available)
- `orgId` (if available)
- `ip`
- `endpoint`
- `method`
- `timestamp`
- `reason`

## Environment Variables

Security layer env configuration:

```bash
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_BURST=20
BRUTE_FORCE_MAX_ATTEMPTS=5
BRUTE_FORCE_BLOCK_MS=900000
MAX_BODY_SIZE=2MB
SECURITY_HEADERS_ENABLED=true
CSRF_PROTECTION_ENABLED=true
SECURITY_AUTO_THROTTLE_ENABLED=true
SUSPICIOUS_SCORE_THRESHOLD=20
```

Default validation lives in:

- `src/config/env.validation.ts`
- `.env.example`
- `.env.test`

## Middleware Order

The order in `SecurityModule` is intentional:

1. `HeadersSecurityMiddleware`
2. `RequestSizeLimitMiddleware`
3. `RateLimitMiddleware`
4. `PayloadSanitizationMiddleware`
5. `CsrfProtectionMiddleware`
6. `BruteForceProtectionMiddleware` (auth routes only)

Why this order:

- Fast rejection first (`size`, `rate`)
- Deep payload analysis only if request survives early checks
- CSRF checked after payload normalization
- Brute-force logic isolated to authentication entry points

## Testing

Security tests are located in:

- `test/security/attack-detection.service.spec.ts`
- `test/security/payload-sanitization.middleware.spec.ts`
- `test/security/security-layer.integration.spec.ts`

Run only security suites:

```bash
npm test -- --runInBand \
  test/security/attack-detection.service.spec.ts \
  test/security/payload-sanitization.middleware.spec.ts \
  test/security/security-layer.integration.spec.ts
```

Coverage validated by tests:

- Rate-limit blocking behavior
- Brute-force block timing
- Payload sanitization and malicious payload blocking
- CSRF rejection path
- Oversized payload rejection
- Security event emission (`security.blocked`)

## Operational Notes

- Keep Redis healthy: security counters and blocks depend on Redis availability.
- In production, enforce HTTPS to make HSTS and cookie protections meaningful.
- Review `security.blocked` and `security.suspicious` audit events regularly.
- Tune thresholds based on real traffic to avoid false positives.

## Rollout Checklist

- [ ] Add/verify security env values in deployment environments
- [ ] Validate reverse proxy forwards client IP (`x-forwarded-for`)
- [ ] Confirm `/billing/webhook` raw body flow remains intact
- [ ] Run security test suite in CI
- [ ] Verify audit events are visible in logs/DB
- [ ] Perform a lightweight API security smoke test before production release
