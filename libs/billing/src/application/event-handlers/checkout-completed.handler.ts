import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from '../services/subscription.service';

/**
 * CheckoutCompletedHandler
 * Processes checkout.session.completed Stripe webhook events.
 *
 * On a completed checkout this handler:
 *   1. Persists stripeCustomerId on the org if not already set
 *   2. Persists the new subscriptionId
 *   3. Sets billingStatus → ACTIVE
 *   4. Writes activity + legal audit logs
 *   5. Dispatches the BILLING_CHECKOUT_COMPLETED domain event
 */
@Injectable()
export class CheckoutCompletedHandler {
  private readonly logger = new Logger(CheckoutCompletedHandler.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    this.logger.log(
      `Processing checkout.session.completed: session=${session.id}`,
    );

    await this.subscriptionService.handleCheckoutCompleted(session, {
      stripeEventId: event.id,
    });

    this.logger.debug(`checkout.session.completed handled: ${session.id}`);
  }
}
