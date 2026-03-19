import { Module } from '@nestjs/common';
import { TenantModule } from '@libs/common';
import {
  MembershipsModule as MembershipsLibModule,
  MEMBERSHIP_CACHE_NOTIFIER,
} from '@libs/memberships';
import { MembershipsController } from './memberships.controller';
import { RBACModule, RBACCacheService } from '@libs/rbac';

@Module({
  imports: [MembershipsLibModule, RBACModule, TenantModule],
  controllers: [MembershipsController],
  providers: [
    { provide: MEMBERSHIP_CACHE_NOTIFIER, useExisting: RBACCacheService },
  ],
})
export class MembershipsModule {}
