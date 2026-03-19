import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { SubscriptionService } from '../services/subscription.service';

/**
 * InvoiceFailedHandler
 * Processes invoice.payment_failed Stripe webhook events.
 *
 * Sets billingStatus to PAST_DUE and dispatches the BILLING_PAYMENT_FAILED
 * domain event.
 */
@Injectable()
export class InvoiceFailedHandler {
  private readonly logger = new Logger(InvoiceFailedHandler.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  async handle(event: Stripe.Event): Promise<void> {
    const invoice = event.data.object as Stripe.Invoice;

    this.logger.log(
      `Processing invoice.payment_failed: ${invoice.id} (attempt: ${invoice.attempt_count})`,
    );

    await this.subscriptionService.handleInvoiceFailed(invoice);

    this.logger.debug(`invoice.payment_failed handled: ${invoice.id}`);
  }
}
