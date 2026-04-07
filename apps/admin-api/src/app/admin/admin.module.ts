import { Module } from '@nestjs/common';
import { AdminAuthModule } from '@libs/admin/auth';
import { AdminOrganizationsModule } from '@libs/admin/organizations';
import { AdminMembershipsModule } from '@libs/admin/memberships';
import { AdminBillingModule } from '@libs/admin/billing';
import { AdminActivityLogModule } from '@libs/admin/activity-log';
import { AdminEntitlementsModule } from '@libs/admin/entitlements';
import { AdminJobsModule } from '@libs/admin/jobs';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminMembershipsController } from './admin-memberships.controller';
import { AdminBillingController } from './admin-billing.controller';
import { AdminActivityLogController } from './admin-activity-log.controller';
import { AdminEntitlementsController } from './admin-entitlements.controller';
import { AdminFeatureFlagsController } from './admin-feature-flags.controller';
import { AdminJobsController } from './admin-jobs.controller';

@Module({
  imports: [
    AdminAuthModule,
    AdminOrganizationsModule,
    AdminMembershipsModule,
    AdminBillingModule,
    AdminActivityLogModule,
    AdminEntitlementsModule,
    AdminJobsModule,
  ],
  controllers: [
    AdminOrganizationsController,
    AdminMembershipsController,
    AdminBillingController,
    AdminActivityLogController,
    AdminEntitlementsController,
    AdminFeatureFlagsController,
    AdminJobsController,
  ],
})
export class AdminModule {}
