import { Module } from '@nestjs/common';
import { StorageModule } from '@libs/storage';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '@libs/rbac';
import { StorageController } from './storage.controller';

/**
 * StorageAppModule
 * HTTP layer for storage features in the api application.
 *
 * Mounts StorageController, using the authentication and RBAC guards
 * already present in the api app. Delegates all business logic to the
 * services exported from the shared StorageModule.
 */
@Module({
  imports: [StorageModule, AuthModule, RBACModule],
  controllers: [StorageController],
})
export class StorageAppModule {}
