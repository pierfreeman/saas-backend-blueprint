import { Module } from '@nestjs/common';
import { FeatureFlagsModule as FeatureFlagsLibModule } from '@libs/feature-flags';
import { RBACModule } from '@libs/rbac';
import { FeatureFlagsController } from './feature-flags.controller';

/**
 * FeatureFlagsModule
 *
 * Provides plan-based entitlement checks derived from Organization.billingStatus
 * and Organization.planId (Stripe Price ID), with Redis caching.
 *
 * Import this module wherever FeatureFlagsService or FeatureGuard is needed:
 *
 * ```typescript
 * // In any module that enforces feature gates or resource limits:
 * @Module({ imports: [FeatureFlagsModule, ...] })
 * export class SomeModule {}
 * ```
 *
 * Usage – route-level feature gate:
 * ```typescript
 * @Get('analytics')
 * @UseGuards(JwtAuthGuard, OrgContextGuard, FeatureGuard)
 * @RequireFeature('advancedAnalytics')
 * async getAnalytics(@Param('orgId') orgId: string) { ... }
 * ```
 *
 * Usage – resource limit check inside a service:
 * ```typescript
 * const check = await this.featureFlagsService.checkLimit(orgId, 'maxPlayers', currentCount);
 * if (!check.allowed) throw new BadRequestException(`Limit reached: ${check.current}/${check.limit}`);
 * ```
 *
 * Plan tier resolution is driven by env vars (see FeatureFlagsService):
 *   STRIPE_PRICE_ID_PRO   → PRO tier
 *   STRIPE_PRICE_ID_ENTERPRISE → ENTERPRISE tier
 *   (none / unknown)      → FREE tier
 *
 * Cache TTL: FEATURE_FLAGS_CACHE_TTL (seconds, default 600).
 */
@Module({
  imports: [FeatureFlagsLibModule, RBACModule],
  controllers: [FeatureFlagsController],
})
export class FeatureFlagsModule {}
