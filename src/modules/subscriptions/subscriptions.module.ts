import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [MembershipsModule, RBACModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
