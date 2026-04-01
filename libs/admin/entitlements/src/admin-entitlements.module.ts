import { Module } from '@nestjs/common';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { AdminEntitlementsService } from './admin-entitlements.service';

@Module({
  imports: [FeatureFlagsModule],
  providers: [AdminEntitlementsService],
  exports: [AdminEntitlementsService],
})
export class AdminEntitlementsModule {}
