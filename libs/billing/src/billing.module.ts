import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EmailModule } from '@libs/email';

// Infrastructure
import { StripeClient } from './infrastructure/stripe/stripe.client';
import { StripeService } from './infrastructure/stripe/stripe.service';
import { BillingRepository } from './infrastructure/repositories/billing.repository';

// Application
import { BillingService } from './application/services/billing.service';
import { SubscriptionService } from './application/services/subscription.service';

// Application — event handlers (Stripe webhooks → domain reactions)
import { WebhookDispatcherService } from './application/event-handlers/webhook-dispatcher.service';
import { CheckoutCompletedHandler } from './application/event-handlers/checkout-completed.handler';
import { SubscriptionCreatedHandler } from './application/event-handlers/subscription-created.handler';
import { SubscriptionUpdatedHandler } from './application/event-handlers/subscription-updated.handler';
import { InvoicePaidHandler } from './application/event-handlers/invoice-paid.handler';
import { InvoiceFailedHandler } from './application/event-handlers/invoice-failed.handler';

// Application — domain event handlers (billing lifecycle emails)
import { BillingEmailHandler } from './application/event-handlers/billing-email.handler';

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
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule, EmailModule],
  providers: [
    // Infrastructure
    StripeClient,
    StripeService,
    BillingRepository,

    // Application
    BillingService,
    SubscriptionService,

    // Application — event handlers
    WebhookDispatcherService,
    CheckoutCompletedHandler,
    SubscriptionCreatedHandler,
    SubscriptionUpdatedHandler,
    InvoicePaidHandler,
    InvoiceFailedHandler,

    // Application — domain event handlers
    BillingEmailHandler,
  ],
  exports: [
    BillingService,
    SubscriptionService,
    StripeService,
    WebhookDispatcherService,
    BillingEmailHandler,
  ],
})
export class BillingModule {}
