import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@libs/events';
import { EmailService } from '@libs/email';
import { BillingRepository } from '../../infrastructure/repositories/billing.repository';

export interface PlanChangedPayload extends Record<string, unknown> {
  orgId: string;
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  previousPlanId: string | null;
  newPlanId: string | null;
  /** Value from resolveActivityAction — e.g. 'subscription.upgraded', 'subscription.updated' */
  planChangeDirection: string;
}

export interface PaymentSucceededPayload extends Record<string, unknown> {
  orgId: string;
  invoiceId: string;
  amountPaid: number;
  currency: string;
}

export interface SubscriptionCancelledPayload extends Record<string, unknown> {
  orgId: string;
  subscriptionId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
}

/**
 * BillingEmailHandler
 *
 * Listens for billing domain events and sends transactional emails to the
 * org OWNER. Registered in BillingModule as a provider / export and
 * consumed by WorkerController in apps/worker-a.
 *
 * All methods are fire-and-forget: errors are logged but never rethrown so
 * that a failed email send cannot abort SQS message processing.
 *
 * NOTE (Production): billing events are published to the SQS FIFO queue.
 * worker-a currently polls only the SQS Standard queue. The dispatch cases
 * are in place but will only be reached in local dev (LocalTransport delivers
 * all events in-process). A dedicated FIFO consumer is required for production
 * delivery — see libs/billing/README.md § "TODO: FIFO consumer".
 */
@Injectable()
export class BillingEmailHandler {
  private readonly logger = new Logger(BillingEmailHandler.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly billingRepository: BillingRepository,
  ) {}

  /**
   * Handles SUBSCRIPTION_PLAN_CHANGED events.
   * Sends either a plan-upgraded or plan-downgraded email based on
   * the planChangeDirection carried in the event payload.
   */
  async handlePlanChanged(
    event: DomainEvent<PlanChangedPayload>,
  ): Promise<void> {
    const { orgId, previousPlanId, newPlanId, planChangeDirection } =
      event.payload;

    try {
      const { name: organizationName, ownerEmail } =
        await this.billingRepository.findOrgMeta(orgId);

      if (!ownerEmail) {
        this.logger.warn(
          `No owner email found for org ${orgId} — skipping plan-changed email`,
        );
        return;
      }

      const isUpgrade = planChangeDirection === 'subscription.upgraded';
      const templateName = isUpgrade
        ? 'billing-plan-upgraded'
        : 'billing-plan-downgraded';
      const subject = isUpgrade
        ? `Your ${organizationName} plan has been upgraded`
        : `Your ${organizationName} plan has been updated`;

      await this.emailService.sendTransactionalEmail({
        templateName,
        recipient: ownerEmail,
        subject,
        data: {
          userName: ownerEmail,
          organizationName,
          previousPlanId: previousPlanId ?? 'N/A',
          newPlanId: newPlanId ?? 'N/A',
          billingPortalUrl: process.env['BILLING_PORTAL_URL'] ?? '#',
        },
        orgId,
        userId: event.userId,
      });

      this.logger.log(
        `Billing plan-changed email (${templateName}) sent to ${ownerEmail} for org ${orgId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle SUBSCRIPTION_PLAN_CHANGED for org ${orgId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Handles BILLING_PAYMENT_SUCCEEDED events.
   * Sends a payment-received confirmation email to the org owner.
   */
  async handlePaymentSucceeded(
    event: DomainEvent<PaymentSucceededPayload>,
  ): Promise<void> {
    const { orgId, invoiceId, amountPaid, currency } = event.payload;

    try {
      const { name: organizationName, ownerEmail } =
        await this.billingRepository.findOrgMeta(orgId);

      if (!ownerEmail) {
        this.logger.warn(
          `No owner email found for org ${orgId} — skipping payment-received email`,
        );
        return;
      }

      // Convert from smallest currency unit (cents) to major unit (dollars/euros)
      const formattedAmount = (amountPaid / 100).toFixed(2);

      await this.emailService.sendTransactionalEmail({
        templateName: 'billing-payment-received',
        recipient: ownerEmail,
        subject: `Payment received for ${organizationName}`,
        data: {
          userName: ownerEmail,
          organizationName,
          amountPaid: formattedAmount,
          currency: currency.toUpperCase(),
          invoiceId,
        },
        orgId,
        userId: event.userId,
      });

      this.logger.log(
        `Payment received email sent to ${ownerEmail} for org ${orgId} (invoice ${invoiceId})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle BILLING_PAYMENT_SUCCEEDED for org ${orgId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Handles BILLING_SUBSCRIPTION_CANCELLED events.
   * Sends a cancellation confirmation email to the org owner.
   */
  async handleSubscriptionCancelled(
    event: DomainEvent<SubscriptionCancelledPayload>,
  ): Promise<void> {
    const { orgId } = event.payload;

    try {
      const { name: organizationName, ownerEmail } =
        await this.billingRepository.findOrgMeta(orgId);

      if (!ownerEmail) {
        this.logger.warn(
          `No owner email found for org ${orgId} — skipping cancellation email`,
        );
        return;
      }

      await this.emailService.sendTransactionalEmail({
        templateName: 'billing-plan-cancelled',
        recipient: ownerEmail,
        subject: `Your ${organizationName} subscription has been cancelled`,
        data: {
          userName: ownerEmail,
          organizationName,
          billingPortalUrl: process.env['BILLING_PORTAL_URL'] ?? '#',
        },
        orgId,
        userId: event.userId,
      });

      this.logger.log(
        `Cancellation email sent to ${ownerEmail} for org ${orgId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle BILLING_SUBSCRIPTION_CANCELLED for org ${orgId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
