import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { CheckoutCompletedHandler } from './handlers/checkout-completed.handler';
import { SubscriptionCreatedHandler } from './handlers/subscription-created.handler';
import { SubscriptionUpdatedHandler } from './handlers/subscription-updated.handler';
import { InvoicePaidHandler } from './handlers/invoice-paid.handler';
import { InvoiceFailedHandler } from './handlers/invoice-failed.handler';

/**
 * WebhookDispatcherService
 * Routes incoming Stripe webhook events to the appropriate handler.
 *
 * Known events:
 *   checkout.session.completed           → CheckoutCompletedHandler
 *   customer.subscription.created        → SubscriptionCreatedHandler
 *   customer.subscription.updated        → SubscriptionUpdatedHandler
 *   customer.subscription.deleted        → SubscriptionUpdatedHandler
 *   customer.subscription.trial_will_end → SubscriptionUpdatedHandler
 *   invoice.payment_succeeded            → InvoicePaidHandler
 *   invoice.payment_failed               → InvoiceFailedHandler
 *
 * Unknown events are logged and ignored (always return gracefully).
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly checkoutCompletedHandler: CheckoutCompletedHandler,
    private readonly subscriptionCreatedHandler: SubscriptionCreatedHandler,
    private readonly subscriptionUpdatedHandler: SubscriptionUpdatedHandler,
    private readonly invoicePaidHandler: InvoicePaidHandler,
    private readonly invoiceFailedHandler: InvoiceFailedHandler,
  ) {}

  /**
   * Dispatches the event to the correct handler.
   * Errors inside handlers are logged but do NOT propagate — the webhook
   * controller always returns 200 to Stripe to prevent retries for logic errors.
   */
  async dispatch(event: Stripe.Event): Promise<void> {
    this.logger.log(
      `Dispatching Stripe event: ${event.type} (id: ${event.id})`,
    );

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.checkoutCompletedHandler.handle(event);
          break;

        case 'customer.subscription.created':
          await this.subscriptionCreatedHandler.handle(event);
          break;

        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'customer.subscription.trial_will_end':
          await this.subscriptionUpdatedHandler.handle(event);
          break;

        case 'invoice.payment_succeeded':
          await this.invoicePaidHandler.handle(event);
          break;

        case 'invoice.payment_failed':
          await this.invoiceFailedHandler.handle(event);
          break;

        default:
          this.logger.debug(`Unhandled Stripe event type: ${event.type}`);
      }
    } catch (err) {
      this.logger.error(
        `Error processing Stripe event ${event.type} (${event.id}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      // Do not rethrow — webhook controller returns 200 to Stripe regardless
    }
  }
}
