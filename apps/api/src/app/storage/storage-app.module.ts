import { Module } from '@nestjs/common';
import { StorageModule } from '@libs/storage';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '@libs/rbac';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { BillingModule } from '@libs/billing';
import { StorageController } from './storage.controller';

/**
 * StorageAppModule
 * HTTP layer for storage features in the api application.
 *
 * Mounts StorageController, using the authentication and RBAC guards
 * already present in the api app. Delegates all business logic to the
 * services exported from the shared StorageModule.
 *
 * FeatureFlagsModule and BillingModule are imported so the controller
 * can resolve the organisation's plan tier and per-org storage override
 * when enforcing upload quotas.
 */
@Module({
  imports: [
    StorageModule,
    AuthModule,
    RBACModule,
    FeatureFlagsModule,
    BillingModule,
  ],
  controllers: [StorageController],
})
export class StorageAppModule {}
