# feature-flags

Plan-based entitlement system for the API.

Derives a set of boolean feature flags and numeric resource limits from an organization's current billing tier. No dedicated database table is required — all entitlements are computed from `Organization.billingStatus` and `Organization.planId` (Stripe Price ID) with a Redis cache layer.

---

## Files

```
feature-flags/
├── interfaces/
│   └── entitlements.interface.ts   PlanEntitlements + OrganizationEntitlements
├── guards/
│   ├── feature.guard.ts            RequireFeature decorator + FeatureGuard
│   └── feature.guard.spec.ts
├── feature-flags.module.ts
├── feature-flags.module.spec.ts
├── feature-flags.service.ts
├── feature-flags.service.spec.ts
├── feature-flags.controller.ts
└── feature-flags.controller.spec.ts
```

---

## Plan tiers

| Feature             | FREE  | PRO   | ENTERPRISE |
| ------------------- | ----- | ----- | ---------- |
| `advancedAnalytics` | false | true  | true       |
| `customReports`     | false | true  | true       |
| `apiAccess`         | false | true  | true       |
| `ssoEnabled`        | false | false | true       |
| `prioritySupport`   | false | false | true       |

**Downgrade rule**: if `billingStatus !== ACTIVE` (e.g. `PAST_DUE`, `CANCELED`, `UNPAID`) the tier is silently set to `FREE`, regardless of the recorded plan.

**No subscription**: if the organization has no billing record at all, it is treated as `FREE/NONE`.

---

## Plan tier resolution

Tier is derived from `Organization.planId` (a Stripe Price ID) via environment variables:

| Env var                      | Maps to    |
| ---------------------------- | ---------- |
| `STRIPE_PRICE_ID_PRO`        | PRO        |
| `STRIPE_PRICE_ID_ENTERPRISE` | ENTERPRISE |
| anything else / null         | FREE       |

---

## HTTP endpoints

Both endpoints are guarded by `JwtAuthGuard` + `OrgContextGuard`.

| Method | Path                                            | Description                         |
| ------ | ----------------------------------------------- | ----------------------------------- |
| GET    | `/organizations/:orgId/entitlements`            | Returns `OrganizationEntitlements`  |
| POST   | `/organizations/:orgId/entitlements/invalidate` | Flushes the Redis cache for the org |

---

## Usage

### 1. Route-level feature gate

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { FeatureGuard, RequireFeature } from '../feature-flags/guards/feature.guard';

@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, FeatureGuard)
@Controller('organizations/:orgId/reports')
export class ReportsController {
  @Get()
  @RequireFeature('customReports')
  async getReports(@Param('orgId') orgId: string) { ... }
}
```

Guard pipeline order matters: `JwtAuthGuard` sets `req.user`, `OrgContextGuard` sets `req.orgId`, then `FeatureGuard` reads both.

### 2. Resource limit check inside a service

```typescript
constructor(private readonly featureFlags: FeatureFlagsService) {}

async createPlayer(orgId: string, dto: CreatePlayerDto) {
  const count = await this.prisma.player.count({ where: { orgId } });
  const check = await this.featureFlags.checkLimit(orgId, 'maxPlayers', count);

  if (!check.allowed) {
    throw new BadRequestException(
      `Player limit reached. Your plan allows ${check.limit}, you currently have ${check.current}.`,
    );
  }
  // ...
}
```

### 3. Importing the module

```typescript
// In any module that needs feature gates or limit checks:
@Module({
  imports: [FeatureFlagsModule, ...],
  // FeatureFlagsService and FeatureGuard are re-exported and available for injection.
})
export class PlayersModule {}
```

`FeatureFlagsModule` is also imported globally in `AppModule`.

---

## Cache

- **Redis key**: `entitlements:<orgId>`
- **TTL**: `FEATURE_FLAGS_CACHE_TTL` env var (seconds, default `600`)
- **Auto-invalidation** (local mode only): the service listens to `subscription.plan.changed`, `billing.subscription.cancelled`, `subscription.activated`, and `subscription.expired` events via `LocalTransport.on()`.
- **Manual invalidation**: `POST /organizations/:orgId/entitlements/invalidate` or `FeatureFlagsService.invalidateEntitlements(orgId)`.

In SQS mode the auto-invalidation listeners are registered but will never fire (LocalTransport is used only in local/test mode). Rely on TTL expiry or the HTTP endpoint.

---

## Environment variables

| Variable                     | Default | Description                                  |
| ---------------------------- | ------- | -------------------------------------------- |
| `FEATURE_FLAGS_CACHE_TTL`    | `600`   | Redis TTL for entitlements (seconds)         |
| `STRIPE_PRICE_ID_PRO`        | —       | Stripe Price ID that maps to PRO tier        |
| `STRIPE_PRICE_ID_ENTERPRISE` | —       | Stripe Price ID that maps to ENTERPRISE tier |

---

## Tests

```bash
# Run all feature-flags tests
npx nx test api --testPathPattern=feature-flags

# With coverage
npx nx test api --testPathPattern=feature-flags --coverage
```

| File                               | What is tested                                                  |
| ---------------------------------- | --------------------------------------------------------------- |
| `feature-flags.service.spec.ts`    | Cache hit/miss, plan tier resolution, downgrade rule, limits    |
| `feature-flags.controller.spec.ts` | Delegation to service, error propagation                        |
| `guards/feature.guard.spec.ts`     | Metadata reading, ForbiddenException on missing feature / orgId |
| `feature-flags.module.spec.ts`     | NestJS metadata: providers, exports, controllers                |

---

## Future iterations

### Per-org admin overrides (backoffice panel)

The current implementation is **tier-based**: every org on the same plan gets identical entitlements. If you need to toggle individual flags per org from a backoffice admin UI at runtime (without a code deploy), the following changes are required:

**1. New Prisma model**

```prisma
model FeatureFlagOverride {
  id           String       @id @default(cuid())
  orgId        String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  featureKey   String       // matches a key of PlanEntitlements, e.g. "ssoEnabled"
  enabled      Boolean
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@unique([orgId, featureKey])
  @@schema("public")
}
```

**2. Service change** in `getEntitlements()` (see the `TODO` comment there):

```typescript
// After resolving tier entitlements:
const overrides = await this.prisma.featureFlagOverride.findMany({
  where: { orgId },
});
const overrideMap = Object.fromEntries(
  overrides.map((o) => [o.featureKey, o.enabled]),
);
const entitlements = { ...PLAN_ENTITLEMENTS[tier], ...overrideMap };
```

**3. New admin endpoint**

```
PATCH /admin/organizations/:orgId/feature-flags
Body: { featureKey: "ssoEnabled", enabled: true }
```

The endpoint writes/upserts the override, then calls `invalidateEntitlements(orgId)` so the cache reflects the change immediately.

> **Cache note**: the override records should be included in the Redis cache payload (as they are today for tier flags), so subsequent reads remain a single Redis hit with zero extra DB queries.
