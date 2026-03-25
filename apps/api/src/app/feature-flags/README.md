# feature-flags (app layer)

Thin Pattern F module that wires the `@libs/feature-flags` library into the API.

All business logic (service, guard, interfaces) lives in [`@libs/feature-flags`](../../../../../libs/feature-flags/README.md). This app module only hosts the HTTP controller and re-exports the lib module so NestJS can inject `FeatureFlagsService` and `FeatureGuard` throughout the app.

---

## Files

```
feature-flags/
├── feature-flags.module.ts         Thin module: imports FeatureFlagsLibModule + registers controller
├── feature-flags.module.spec.ts
├── feature-flags.controller.ts     HTTP endpoints – delegates directly to FeatureFlagsService
└── feature-flags.controller.spec.ts
```

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
import { FeatureGuard, RequireFeature } from '@libs/feature-flags';

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

`MembershipsModule` fulfils the `SEAT_LIMIT_PROVIDER` port by wiring `FeatureFlagsService`:

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

### 4. Importing the module

```typescript
import { FeatureFlagsModule } from '@libs/feature-flags';

@Module({
  imports: [FeatureFlagsModule, ...],
})
export class PlayersModule {}
```

`FeatureFlagsModule` is also imported globally in `AppModule`.

---

## Tests

```bash
# Run app-layer controller + module tests
npx nx test api --testPathPattern=feature-flags

# Run library service + guard tests
npx nx test feature-flags
```

See [`@libs/feature-flags`](../../../../../libs/feature-flags/README.md) for full documentation on plan tiers, cache strategy, environment variables, and future iterations.

```
PATCH /admin/organizations/:orgId/feature-flags
Body: { featureKey: "ssoEnabled", enabled: true }
```

The endpoint writes/upserts the override, then calls `invalidateEntitlements(orgId)` so the cache reflects the change immediately.

> **Cache note**: the override records should be included in the Redis cache payload (as they are today for tier flags), so subsequent reads remain a single Redis hit with zero extra DB queries.
