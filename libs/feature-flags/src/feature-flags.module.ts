import { Module } from '@nestjs/common';
import { BillingModule } from '@libs/billing';
import { RedisModule } from '@libs/redis';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureGuard } from './guards/feature.guard';

@Module({
  imports: [BillingModule, RedisModule],
  providers: [FeatureFlagsService, FeatureGuard],
  exports: [FeatureFlagsService, FeatureGuard],
})
export class FeatureFlagsModule {}
