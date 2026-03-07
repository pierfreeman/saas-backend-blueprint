import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeClient } from './stripe.client';

/**
 * StripeService
 * Application-level Stripe API wrapper with error handling and logging.
 *
 * All Stripe API calls go through this service. Raw Stripe errors are caught,
 * logged, and re-thrown as NestJS HTTP exceptions where appropriate.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private readonly stripeClient: StripeClient,
    private readonly configService: ConfigService,
  ) {}

  private get stripe(): Stripe {
    return this.stripeClient.stripe;
  }

  /**
   * Creates a new Stripe customer.
   */
  async createCustomer(
    email: string,
    name: string,
    metadata: Record<string, string> = {},
  ): Promise<Stripe.Customer> {
    try {
      const customer = await this.stripe.customers.create({
        email,
        name,
        metadata,
      });
      this.logger.debug(`Stripe customer created: ${customer.id}`);
      return customer;
    } catch (err) {
      this.logger.error('Failed to create Stripe customer', err);
      throw new InternalServerErrorException(
        'Failed to create billing customer',
      );
    }
  }

  /**
   * Creates a Stripe Checkout Session for subscription purchase.
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<Stripe.Checkout.Session> {
    try {
      const requestOptions: Stripe.RequestOptions = {};
      if (params.idempotencyKey) {
        requestOptions.idempotencyKey = params.idempotencyKey;
      }
      const session = await this.stripe.checkout.sessions.create(
        {
          customer: params.customerId,
          payment_method_types: ['card'],
          line_items: [{ price: params.priceId, quantity: 1 }],
          mode: 'subscription',
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          metadata: params.metadata ?? {},
          subscription_data: {
            metadata: params.metadata ?? {},
          },
        },
        requestOptions,
      );
      this.logger.debug(`Stripe checkout session created: ${session.id}`);
      return session;
    } catch (err) {
      this.logger.error('Failed to create Stripe checkout session', err);
      throw new InternalServerErrorException(
        'Failed to create checkout session',
      );
    }
  }

  /**
   * Creates a Stripe Billing Portal session for subscription management.
   */
  async createPortalSession(
    customerId: string,
    returnUrl: string,
  ): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      this.logger.debug(
        `Stripe portal session created for customer: ${customerId}`,
      );
      return session;
    } catch (err) {
      this.logger.error('Failed to create Stripe portal session', err);
      throw new InternalServerErrorException(
        'Failed to create billing portal session',
      );
    }
  }

  /**
   * Retrieves a Stripe subscription.
   */
  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      return await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (err) {
      this.logger.error(
        `Failed to retrieve subscription ${subscriptionId}`,
        err,
      );
      throw new InternalServerErrorException('Failed to retrieve subscription');
    }
  }

  /**
   * Cancels a Stripe subscription at the end of the current billing period.
   * Sets cancel_at_period_end = true (graceful cancellation).
   */
  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Stripe.Subscription> {
    try {
      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      this.logger.debug(
        `Stripe subscription scheduled for cancellation: ${subscriptionId}`,
      );
      return sub;
    } catch (err) {
      this.logger.error(`Failed to cancel subscription ${subscriptionId}`, err);
      throw new InternalServerErrorException('Failed to cancel subscription');
    }
  }

  /**
   * Constructs and verifies a Stripe webhook event from the raw request body
   * and signature header.
   *
   * ⚠  Security: MUST use the raw request body (not parsed JSON) or signature
   *    verification will fail and the event must be rejected.
   *
   * @throws StripeSignatureVerificationError on invalid or expired signature
   */
  constructWebhookEvent(
    rawBody: Buffer | string,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }
}
