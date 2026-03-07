import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { SubscriptionCreatedHandler } from './handlers/subscription-created.handler';
import { SubscriptionUpdatedHandler } from './handlers/subscription-updated.handler';
import { InvoicePaidHandler } from './handlers/invoice-paid.handler';
import { InvoiceFailedHandler } from './handlers/invoice-failed.handler';

/**
 * WebhookDispatcherService
 * Routes incoming Stripe webhook events to the appropriate handler.
 *
 * Known events:
 *   checkout.session.completed         → inline (customer ID sync)
 *   customer.subscription.created      → SubscriptionCreatedHandler
 *   customer.subscription.updated      → SubscriptionUpdatedHandler
 *   customer.subscription.deleted      → SubscriptionUpdatedHandler
 *   customer.subscription.trial_will_end → SubscriptionUpdatedHandler
 *   invoice.payment_succeeded          → InvoicePaidHandler
 *   invoice.payment_failed             → InvoiceFailedHandler
 *
 * Unknown events are logged and ignored (always return gracefully).
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly subscriptionCreatedHandler: SubscriptionCreatedHandler,
    private readonly subscriptionUpdatedHandler: SubscriptionUpdatedHandler,
    private readonly invoicePaidHandler: InvoicePaidHandler,
    private readonly invoiceFailedHandler: InvoiceFailedHandler,
    private readonly billingRepository: BillingRepository,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
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
          await this.handleCheckoutCompleted(event);
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

  /**
   * Handles checkout.session.completed.
   * If the session includes a Stripe customer ID and we have a matching org,
   * ensures the stripeCustomerId is persisted (it may already be set).
   */
  private async handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as Stripe.Checkout.Session;

    this.logger.log(`checkout.session.completed: session=${session.id}`);

    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    if (!customerId) {
      this.logger.warn('checkout.session.completed: no customer ID in session');
      return;
    }

    // Extract orgId from session metadata (set during checkout session creation)
    const orgId = session.metadata?.['orgId'];

    if (orgId) {
      // Persist stripeCustomerId if not already recorded
      const org = await this.billingRepository
        .findOrgById(orgId)
        .catch(() => null);
      if (org && !org.stripeCustomerId) {
        await this.billingRepository.updateOrgBillingData(orgId, {
          stripeCustomerId: customerId,
        });
        this.logger.log(
          `Persisted stripeCustomerId ${customerId} for org ${orgId}`,
        );
      }

      this.activityLog.logActivity({
        orgId,
        action: 'billing.checkout.completed',
        entityType: 'organization',
        entityId: orgId,
        metadata: {
          sessionId: session.id,
          stripeCustomerId: customerId,
          subscriptionId:
            typeof session.subscription === 'string'
              ? session.subscription
              : (session.subscription?.id ?? null),
        },
      });
    }

    this.legalAudit.recordEvent({
      eventType: 'billing.checkout.completed',
      orgId: orgId ?? undefined,
      triggerType: 'system',
      metadata: {
        sessionId: session.id,
        stripeCustomerId: customerId,
        mode: session.mode,
      },
    });
  }
}
