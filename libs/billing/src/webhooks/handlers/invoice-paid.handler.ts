import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from '../../application/services/subscription.service';

/**
 * InvoicePaidHandler
 * Processes invoice.payment_succeeded Stripe webhook events.
 *
 * Activates the subscription (sets billingStatus → ACTIVE) and dispatches the
 * BILLING_PAYMENT_SUCCEEDED domain event.
 */
@Injectable()
export class InvoicePaidHandler {
  private readonly logger = new Logger(InvoicePaidHandler.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    this.logger.log(`Processing invoice.payment_succeeded: ${invoice.id}`);

    await this.subscriptionService.handleInvoicePaid(invoice);

    this.logger.debug(`invoice.payment_succeeded handled: ${invoice.id}`);
  }
}
