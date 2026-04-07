import { Module } from '@nestjs/common';
import { BillingModule } from '@libs/billing';
import { RedisModule } from '@libs/redis';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureGuard } from './guards/feature.guard';
import { EntitlementOverrideRepository } from './infrastructure/repositories/entitlement-override.repository';

@Module({
  imports: [BillingModule, RedisModule, PrismaBusinessModule],
  providers: [FeatureFlagsService, FeatureGuard, EntitlementOverrideRepository],
  exports: [FeatureFlagsService, FeatureGuard],
})
export class FeatureFlagsModule {}
