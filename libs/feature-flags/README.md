# @libs/feature-flags

Plan-based entitlement system (Pattern E library).

Derives a set of boolean feature flags, numeric resource limits, and per-plan seat caps from an organization's current billing tier. No dedicated database table is required — all entitlements are computed from `Organization.billingStatus` and `Organization.planId` (Stripe Price ID) with a Redis cache layer.

Implements the `ISeatLimitProvider` interface exported by `@libs/memberships`, so `MembershipsModule` can wire it in as `SEAT_LIMIT_PROVIDER` to enforce per-plan seat caps.

---

## Files

```
libs/feature-flags/src/
├── interfaces/
│   └── entitlements.interface.ts   PlanEntitlements + OrganizationEntitlements
├── guards/
│   └── feature.guard.ts            RequireFeature decorator + FeatureGuard
├── feature-flags.module.ts         NestJS module (imports BillingModule, RedisModule, RBACModule)
├── feature-flags.service.ts        Core entitlement service
├── feature-flags.service.spec.ts
└── index.ts                        Public barrel
```

The HTTP controller lives in the app layer at `apps/api/src/app/feature-flags/`.

---

## Plan tiers

| Feature             | FREE  | PRO   | ENTERPRISE |
| ------------------- | ----- | ----- | ---------- |
| `advancedAnalytics` | false | true  | true       |
| `customReports`     | false | true  | true       |
| `apiAccess`         | false | true  | true       |
| `ssoEnabled`        | false | false | true       |
| `prioritySupport`   | false | false | true       |
| `maxSeats`          | 3     | 10    | 999999     |

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

## Public API

| Export                     | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `FeatureFlagsModule`       | NestJS module — import where you need the service or guard        |
| `FeatureFlagsService`      | Core service (entitlements, limits, seat cap, cache invalidation) |
| `FeatureGuard`             | Route guard — enforces `@RequireFeature()` metadata               |
| `RequireFeature`           | Decorator — marks a route as requiring a specific plan feature    |
| `FEATURE_KEY`              | Metadata key used internally by `FeatureGuard`                    |
| `PlanEntitlements`         | Interface — boolean flags + `maxSeats` per tier                   |
| `OrganizationEntitlements` | Extends `PlanEntitlements` with org context fields                |

---

## FeatureFlagsService methods

| Method                                 | Description                                                               |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `getEntitlements(orgId)`               | Returns `OrganizationEntitlements` (cache-first)                          |
| `setEntitlements(orgId, entitlements)` | Writes directly into Redis (useful in tests / admin overrides)            |
| `checkFeature(orgId, featureKey)`      | Returns `true` if the boolean flag is enabled for the org                 |
| `checkLimit(orgId, limitKey, count)`   | Returns `{ allowed, limit, current }` for resource limits                 |
| `getMaxSeats(orgId)`                   | Returns the seat cap for the org's plan (implements `ISeatLimitProvider`) |
| `invalidateEntitlements(orgId)`        | Removes the Redis cache entry, forcing a DB refresh                       |

---

## Usage

### 1. Route-level feature gate

```typescript
import { FeatureFlagsModule, FeatureGuard, RequireFeature } from '@libs/feature-flags';

@Module({ imports: [FeatureFlagsModule, ...] })
export class ReportsModule {}

// In the controller:
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
import { FeatureFlagsService } from '@libs/feature-flags';

constructor(private readonly featureFlags: FeatureFlagsService) {}

async createPlayer(orgId: string, dto: CreatePlayerDto) {
  const count = await this.prisma.player.count({ where: { orgId } });
  const check = await this.featureFlags.checkLimit(orgId, 'maxPlayers', count);

  if (!check.allowed) {
    throw new BadRequestException(
      `Player limit reached. Your plan allows ${check.limit}, you currently have ${check.current}.`,
    );
  }
}
```

### 3. Seat limit provider (memberships)

`MembershipsModule` (app layer) implements the `ISeatLimitProvider` port by wiring `FeatureFlagsService`:

```typescript
import { FeatureFlagsModule, FeatureFlagsService } from '@libs/feature-flags';
import { SEAT_LIMIT_PROVIDER } from '@libs/memberships';

@Module({
  imports: [MembershipsLibModule, FeatureFlagsModule, ...],
  providers: [
    { provide: SEAT_LIMIT_PROVIDER, useExisting: FeatureFlagsService },
  ],
})
export class MembershipsModule {}
```

When a membership is created, `MembershipsService.checkSeatLimit()` calls `getMaxSeats(orgId)` on the injected provider and compares it against the active member count.

---

## Cache

- **Redis key**: `entitlements:<orgId>`
- **TTL**: `FEATURE_FLAGS_CACHE_TTL` env var (seconds, default `600`)
- **Auto-invalidation** (local mode only): the service subscribes to `subscription.plan.changed`, `billing.subscription.cancelled`, `subscription.activated`, and `subscription.expired` via `LocalTransport.on()` in `onModuleInit()`.
- **Manual invalidation**: `FeatureFlagsService.invalidateEntitlements(orgId)` or `POST /organizations/:orgId/entitlements/invalidate`.

In SQS mode the listeners are registered but will never fire. Rely on TTL expiry or the HTTP endpoint.

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
# Library tests (service)
npx nx test feature-flags

# App-layer tests (controller + module)
npx nx test api --testPathPattern=feature-flags
```

| File                               | Location | What is tested                                                                              |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `feature-flags.service.spec.ts`    | lib      | Cache hit/miss, plan tier resolution, downgrade rule, limits, seat caps                     |
| `feature-flags.controller.spec.ts` | app      | Delegation to service, error propagation                                                    |
| `feature-flags.module.spec.ts`     | app      | NestJS metadata: app module imports lib module; lib module provides/exports service + guard |

---

## Future iterations

### Per-org admin overrides (backoffice panel)

The current implementation is **tier-based**: every org on the same plan gets identical entitlements. A `TODO` comment in `getEntitlements()` marks the integration point. To add per-org overrides:

**1. New Prisma model**

```prisma
model FeatureFlagOverride {
  id           String       @id @default(cuid())
  orgId        String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  featureKey   String       // must match a key of PlanEntitlements
  enabled      Boolean
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@unique([orgId, featureKey])
  @@schema("public")
}
```

**2. Service change** in `getEntitlements()`:

```typescript
const overrides = await this.prisma.featureFlagOverride.findMany({
  where: { orgId },
});
const overrideMap = Object.fromEntries(
  overrides.map((o) => [o.featureKey, o.enabled]),
);
const entitlements = { ...PLAN_ENTITLEMENTS[tier], ...overrideMap };
```

**3. New admin endpoint**: `PATCH /admin/organizations/:orgId/feature-flags`
