import { Module } from '@nestjs/common';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { AdminEntitlementsService } from './admin-entitlements.service';

@Module({
  imports: [FeatureFlagsModule, ActivityLogModule, LegalAuditModule],
  providers: [AdminEntitlementsService],
  exports: [AdminEntitlementsService],
})
export class AdminEntitlementsModule {}
