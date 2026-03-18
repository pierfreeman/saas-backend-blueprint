import { Module } from '@nestjs/common';
import { TenantModule } from '@libs/common';
import {
  MembershipsModule as MembershipsLibModule,
  MEMBERSHIP_CACHE_NOTIFIER,
} from '@libs/memberships';
import { MembershipsController } from './memberships.controller';
import { UserInvitedEmailHandler } from './event-handlers/user-invited-email.handler';
import { RBACModule } from '../rbac/rbac.module';
import { RBACCacheService } from '../rbac/services/rbac-cache.service';
import { EmailModule } from '@libs/email';

@Module({
  imports: [MembershipsLibModule, EmailModule, RBACModule, TenantModule],
  controllers: [MembershipsController],
  providers: [
    { provide: MEMBERSHIP_CACHE_NOTIFIER, useExisting: RBACCacheService },
    UserInvitedEmailHandler,
  ],
})
export class MembershipsModule {}
