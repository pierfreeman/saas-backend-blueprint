import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeService } from './stripe.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [SubscriptionsModule, MembershipsModule, RBACModule],
  controllers: [BillingController],
  providers: [BillingService, StripeService],
  exports: [BillingService, StripeService],
})
export class BillingModule {}
