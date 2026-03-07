import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';

// Infrastructure
import { StripeClient } from './infrastructure/stripe/stripe.client';
import { StripeService } from './infrastructure/stripe/stripe.service';
import { BillingRepository } from './infrastructure/repositories/billing.repository';

// Application
import { BillingService } from './application/services/billing.service';
import { SubscriptionService } from './application/services/subscription.service';

// Webhooks
import { WebhookDispatcherService } from './webhooks/webhook-dispatcher.service';
import { CheckoutCompletedHandler } from './webhooks/handlers/checkout-completed.handler';
import { SubscriptionCreatedHandler } from './webhooks/handlers/subscription-created.handler';
import { SubscriptionUpdatedHandler } from './webhooks/handlers/subscription-updated.handler';
import { InvoicePaidHandler } from './webhooks/handlers/invoice-paid.handler';
import { InvoiceFailedHandler } from './webhooks/handlers/invoice-failed.handler';

/**
 * BillingModule
 * Shared provider module for Stripe billing.
 *
 * Contains all business logic, infrastructure, and webhook processing.
 * Does NOT register HTTP controllers — those live in BillingAppModule
 * inside apps/api/src/app/billing/.
 *
 * Import this module in any app that needs access to billing services:
 *
 * ```typescript
 * // apps/api/src/app/billing/billing-app.module.ts
 * @Module({ imports: [BillingModule, AuthModule, RBACModule], controllers: [...] })
 * export class BillingAppModule {}
 * ```
 *
 * EventBusService is injected via the global EventsModule — no explicit import needed.
 * ConfigService is injected via the global ConfigModule — no explicit import needed.
 */
@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule],
  providers: [
    // Infrastructure
    StripeClient,
    StripeService,
    BillingRepository,

    // Application
    BillingService,
    SubscriptionService,

    // Webhooks
    WebhookDispatcherService,
    CheckoutCompletedHandler,
    SubscriptionCreatedHandler,
    SubscriptionUpdatedHandler,
    InvoicePaidHandler,
    InvoiceFailedHandler,
  ],
  exports: [
    BillingService,
    SubscriptionService,
    BillingRepository,
    StripeService,
    WebhookDispatcherService,
  ],
})
export class BillingModule {}
