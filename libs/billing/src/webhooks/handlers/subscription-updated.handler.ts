import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from '../../application/services/subscription.service';

/**
 * SubscriptionUpdatedHandler
 * Processes customer.subscription.updated, customer.subscription.deleted,
 * and customer.subscription.trial_will_end Stripe webhook events.
 */
@Injectable()
export class SubscriptionUpdatedHandler {
  private readonly logger = new Logger(SubscriptionUpdatedHandler.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    // Capture previous plan before the update via Stripe's previous_attributes
    const previousAttributes = event.data.previous_attributes as
      | Partial<Stripe.Subscription>
      | undefined;
    const previousPlanId =
      (
        previousAttributes?.items?.data?.[0] as
          | Stripe.SubscriptionItem
          | undefined
      )?.price?.id ?? null;

    this.logger.log(
      `Processing ${event.type}: ${subscription.id} (status: ${subscription.status})`,
    );

    await this.subscriptionService.handleSubscriptionUpdated(subscription, {
      eventType: event.type,
      stripeEventId: event.id,
      previousPlanId,
    });

    this.logger.debug(`${event.type} handled: ${subscription.id}`);
  }
}
