# @libs/common

Shared utilities and cross-cutting concerns used across all applications in this monorepo.

---

## Public API (`src/index.ts`)

| Export                  | Description                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `RequestUser`           | Interface for the JWT-decoded user injected by `JwtAuthGuard`                        |
| `PERMISSIONS`           | All RBAC permission constants (string literals)                                      |
| `ROLES`                 | `MembershipRole` constants re-exported for convenience                               |
| `ROLE_HIERARCHY`        | Ordered array `[READ_ONLY, MEMBER, ADMIN, OWNER]`                                    |
| `ROLE_PERMISSIONS`      | Static map `MembershipRole → PermissionKey[]`                                        |
| `isRoleHigherOrEqual()` | Utility: check if a role satisfies a minimum required role                           |
| `TenantContext`         | Type for the multi-tenant request context                                            |
| `TenantMiddleware`      | HTTP middleware that extracts `orgId` from the request header                        |
| `TenantContextService`  | Request-scoped service holding the current tenant context                            |
| `CurrentTenant`         | Parameter decorator to extract a field from the tenant context                       |
| `TenantModule`          | NestJS module that wires up tenant middleware and service                            |
| `AllExceptionsFilter`   | Global exception filter returning `{ statusCode, timestamp, path, method, message }` |
| `REDIS_EVENTS`          | Redis channel name constants                                                         |
| `HeavyJobCreatedEvent`  | Payload interface for the `heavy.job.created` channel                                |

---

## RBAC helpers

### Check permissions

The `@RequirePermissions` decorator (in the API) uses `ROLE_PERMISSIONS` internally.  
For manual checks:

```typescript
import { ROLE_PERMISSIONS, PERMISSIONS } from '@libs/common';

const userPermissions = ROLE_PERMISSIONS[membership.role];
const canManage = userPermissions.includes(PERMISSIONS.ORG_MANAGE);
```

### Check role hierarchy

```typescript
import { isRoleHigherOrEqual } from '@libs/common';

// true if ADMIN satisfies the minimum ADMIN requirement
isRoleHigherOrEqual('ADMIN', 'ADMIN'); // true
isRoleHigherOrEqual('MEMBER', 'ADMIN'); // false
isRoleHigherOrEqual('OWNER', 'ADMIN'); // true
```

---

## Multi-tenancy

Organization-scoped requests carry a `tenantId` (org UUID) that is extracted by `TenantMiddleware` from the `x-tenant-id` request header and stored in the request-scoped `TenantContextService`.

### Extract tenant in a controller

```typescript
import { CurrentTenant } from '@libs/common';

@Get()
findAll(@CurrentTenant('tenantId') tenantId: string) {
  return this.service.findAll(tenantId);
}
```

### Inject the service directly

```typescript
import { TenantContextService } from '@libs/common';

constructor(private readonly tenantCtx: TenantContextService) {}

const { tenantId } = this.tenantCtx.getContext();
```

---

## Global exception filter

`AllExceptionsFilter` is registered globally in `apps/api/src/main.ts`. It converts any unhandled exception to:

```json
{
  "statusCode": 500,
  "timestamp": "2026-02-26T12:34:56.789Z",
  "path": "/organizations/abc",
  "method": "GET",
  "message": "Internal server error"
}
```

NestJS `HttpException`s preserve their original `statusCode` and `message`.

---

## Redis event constants

```typescript
import { REDIS_EVENTS, HeavyJobCreatedEvent } from '@libs/common';

// REDIS_EVENTS.HEAVY_JOB_CREATED  →  'heavy.job.created'
```

When adding a new async job type, add the channel constant and its payload interface to `libs/common/src/events/redis-events.ts`.

---

## Nx tasks

```sh
npx nx build common    # compile
npx nx test common     # unit tests
npx nx lint common     # lint
```
