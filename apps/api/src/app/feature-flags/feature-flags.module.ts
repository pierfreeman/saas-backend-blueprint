import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { RBACModule } from '../rbac/rbac.module';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureGuard } from './guards/feature.guard';

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
 *   STRIPE_PRICE_ID_PRO   → ENTERPRISE tier
 *   STRIPE_PRICE_ID_BASIC → PRO tier
 *   (none / unknown)      → FREE tier
 *
 * Cache TTL: FEATURE_FLAGS_CACHE_TTL (seconds, default 600).
 */
@Module({
  imports: [PrismaBusinessModule, RedisModule, RBACModule],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureGuard],
  exports: [FeatureFlagsService, FeatureGuard],
})
export class FeatureFlagsModule {}
