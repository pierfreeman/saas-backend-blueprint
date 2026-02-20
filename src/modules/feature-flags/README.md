# Feature Flags Module

Feature flags system for granular control of functionality per organization.

## Features

- Organization-scoped feature flags
- Redis caching for performance
- Dynamic enable/disable features
- Guards for feature-gated endpoints

## Usage

```typescript
// Check feature flag
const hasFeature = await this.featureFlagsService.isEnabled(
  orgId, 
  'ADVANCED_ANALYTICS'
);

// Guard for endpoint
@UseGuards(FeatureFlagGuard)
@FeatureFlag('ADVANCED_ANALYTICS')
@Get('analytics')
async getAnalytics() {
  // Only accessible if feature enabled
}
```

## Database Schema

Table `feature_flags`:
- `id`, `orgId`, `flag`
- `enabled` (boolean)
- `createdAt`, `updatedAt`

## Environment Variables

```bash
FEATURE_FLAGS_CACHE_TTL=600  # 10 minutes
```

## Guards

- `FeatureFlagGuard` - Verifies feature is enabled for organization

## Documentation

See [docs/00-INDEX.md](../../../docs/00-INDEX.md) for general documentation.
