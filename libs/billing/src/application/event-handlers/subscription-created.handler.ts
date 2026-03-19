import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from '../services/subscription.service';

/**
 * SubscriptionCreatedHandler
 * Processes customer.subscription.created Stripe webhook events.
 *
 * Syncs the new subscription into the DB, appends a SubscriptionSnapshot,
 * writes activity + legal audit logs, and dispatches the
 * BILLING_SUBSCRIPTION_CREATED domain event.
 */
@Injectable()
export class SubscriptionCreatedHandler {
  private readonly logger = new Logger(SubscriptionCreatedHandler.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const subscription = event.data.object as Stripe.Subscription;

    this.logger.log(
      `Processing subscription.created: ${subscription.id} (status: ${subscription.status})`,
    );

    await this.subscriptionService.handleSubscriptionCreated(subscription, {
      eventType: event.type,
      stripeEventId: event.id,
    });

    this.logger.debug(`subscription.created handled: ${subscription.id}`);
  }
}
