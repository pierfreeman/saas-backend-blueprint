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
 * Application-level Stripe API wrapper with error handling, logging, and
 * exponential-backoff retry logic.
 *
 * All Stripe API calls go through this service. Raw Stripe errors are caught,
 * logged, and re-thrown as NestJS HTTP exceptions where appropriate.
 *
 * Retry policy (configurable via env vars):
 *   STRIPE_MAX_RETRIES        — max retry attempts after the first failure (default: 3)
 *   STRIPE_RETRY_BASE_DELAY_MS — initial backoff delay in ms (default: 500)
 *
 * Retryable conditions:
 *   - StripeConnectionError   — network-level failures / timeouts
 *   - StripeRateLimitError    — HTTP 429: back off and retry
 *   - StripeAPIError 5xx      — transient server-side errors
 *
 * Non-retryable conditions (immediate re-throw):
 *   - StripeAuthenticationError — misconfigured key
 *   - StripeInvalidRequestError — bad input
 *   - StripeCardError           — card-level user errors
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

  // ─── Retry infrastructure ────────────────────────────────────────────────

  /**
   * Executes `fn` and retries with exponential backoff on transient Stripe
   * errors.  Each delay is capped at 10 s and includes ±10 % random jitter
   * to reduce thundering-herd effects.
   *
   * Delay sequence (base = 500 ms, no jitter):
   *   attempt 1 → 500 ms
   *   attempt 2 → 1 000 ms
   *   attempt 3 → 2 000 ms   (maxRetries = 3 ⇒ 4 total calls)
   */
  private async withRetry<T>(
    operationName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const maxRetries =
      this.configService.get<number>('STRIPE_MAX_RETRIES') ?? 3;
    const baseDelayMs =
      this.configService.get<number>('STRIPE_RETRY_BASE_DELAY_MS') ?? 500;
    const maxDelayMs = 10_000;

    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;

        if (!this.isRetryable(err) || attempt === maxRetries) {
          break;
        }

        const exponential = baseDelayMs * 2 ** attempt;
        const jitter = Math.floor(Math.random() * baseDelayMs * 0.1);
        const delayMs = Math.min(exponential + jitter, maxDelayMs);

        this.logger.warn(
          `[${operationName}] Stripe transient error (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `retrying in ${delayMs} ms — ${(err as Error).message ?? String(err)}`,
        );

        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  /**
   * Returns true for error classes that indicate a transient failure that is
   * safe to retry.
   */
  private isRetryable(err: unknown): boolean {
    if (err instanceof Stripe.errors.StripeConnectionError) return true;
    if (err instanceof Stripe.errors.StripeRateLimitError) return true;
    if (
      err instanceof Stripe.errors.StripeAPIError &&
      err.statusCode != null &&
      err.statusCode >= 500
    ) {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      const customer = await this.withRetry('createCustomer', () =>
        this.stripe.customers.create({ email, name, metadata }),
      );
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
      const requestOptions: Stripe.RequestOptions = params.idempotencyKey
        ? { idempotencyKey: params.idempotencyKey }
        : {};
      const session = await this.withRetry('createCheckoutSession', () =>
        this.stripe.checkout.sessions.create(
          {
            customer: params.customerId,
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
        ),
      );
      this.logger.debug(`Stripe checkout session created: ${session.id}`);
      return session;
    } catch (err) {
      const stripeMsg = (err as { message?: string })?.message ?? String(err);
      this.logger.error(
        `Failed to create Stripe checkout session: ${stripeMsg}`,
        err,
      );
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
      const session = await this.withRetry('createPortalSession', () =>
        this.stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: returnUrl,
        }),
      );
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
      return await this.withRetry('retrieveSubscription', () =>
        this.stripe.subscriptions.retrieve(subscriptionId),
      );
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
      const sub = await this.withRetry('cancelSubscription', () =>
        this.stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        }),
      );
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
   * Immediately terminates a Stripe subscription (no grace period).
   * Used during hard org deletion where billing must cease at once.
   */
  async terminateSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.withRetry('terminateSubscription', () =>
        this.stripe.subscriptions.cancel(subscriptionId),
      );
      this.logger.debug(
        `Stripe subscription terminated immediately: ${subscriptionId}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to terminate subscription ${subscriptionId} — may already be cancelled: ${(err as Error).message}`,
      );
      // Non-fatal: subscription may already be cancelled
    }
  }

  /**
   * Permanently deletes a Stripe customer and all associated data.
   * Used during hard org deletion cleanup.
   */
  async deleteCustomer(customerId: string): Promise<void> {
    try {
      await this.withRetry('deleteCustomer', () =>
        this.stripe.customers.del(customerId),
      );
      this.logger.debug(`Stripe customer deleted: ${customerId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to delete Stripe customer ${customerId} — may already be deleted: ${(err as Error).message}`,
      );
      // Non-fatal: customer may already be deleted
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
