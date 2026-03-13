import { Injectable, Logger } from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import Stripe from 'stripe';
import {
  BillingRepository,
  CreateSnapshotInput,
} from '../../infrastructure/repositories/billing.repository';
import { BillingStatus } from '../../domain/enums/billing-status.enum';
import { BillingStatus as PrismaBillingStatus } from '@prisma/client';

/** Context passed from webhook handlers into the sync function. */
export interface SyncContext {
  /** Stripe event type, e.g. 'customer.subscription.created'. */
  eventType: string;
  /** Stripe event ID for legal audit metadata. */
  stripeEventId: string;
  /** Stripe Price ID of the plan BEFORE the change (for upgrade/downgrade detection). */
  previousPlanId?: string | null;
}

/**
 * SubscriptionService
 * Handles synchronization of Stripe subscription data into the local database.
 *
 * Called by webhook handlers to update organization billing state after
 * Stripe subscription lifecycle events.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Maps a Stripe subscription status to the domain BillingStatus enum.
   */
  mapStripeBillingStatus(
    stripeStatus: Stripe.Subscription.Status,
  ): PrismaBillingStatus {
    const mapping: Record<Stripe.Subscription.Status, PrismaBillingStatus> = {
      active: PrismaBillingStatus.ACTIVE,
      canceled: PrismaBillingStatus.CANCELED,
      incomplete: PrismaBillingStatus.INCOMPLETE,
      incomplete_expired: PrismaBillingStatus.INCOMPLETE_EXPIRED,
      past_due: PrismaBillingStatus.PAST_DUE,
      trialing: PrismaBillingStatus.TRIALING,
      unpaid: PrismaBillingStatus.UNPAID,
      paused: PrismaBillingStatus.PAUSED,
    };
    return mapping[stripeStatus] ?? PrismaBillingStatus.NONE;
  }

  /**
   * Determines the ActivityLog action label for a subscription state transition.
   */
  private resolveActivityAction(
    ctx: SyncContext,
    previousPlanId: string | null,
    previousBillingStatus: PrismaBillingStatus,
    newPlanId: string | null,
    newBillingStatus: PrismaBillingStatus,
  ): string {
    if (ctx.eventType === 'customer.subscription.created') {
      return 'subscription.created';
    }

    if (
      ctx.eventType === 'customer.subscription.deleted' ||
      newBillingStatus === PrismaBillingStatus.CANCELED
    ) {
      return 'subscription.cancelled';
    }

    // Reactivation: was inactive, now active
    const inactive: PrismaBillingStatus[] = [
      PrismaBillingStatus.CANCELED,
      PrismaBillingStatus.PAST_DUE,
      PrismaBillingStatus.UNPAID,
    ];
    const active: PrismaBillingStatus[] = [
      PrismaBillingStatus.ACTIVE,
      PrismaBillingStatus.TRIALING,
    ];
    if (
      inactive.includes(previousBillingStatus) &&
      active.includes(newBillingStatus)
    ) {
      return 'subscription.reactivated';
    }

    // Plan change: upgraded or downgraded
    // Without a numeric plan hierarchy we treat any plan change as an upgrade;
    // callers can override via ctx.previousPlanId to distinguish when needed.
    const effectivePrevPlan = ctx.previousPlanId ?? previousPlanId;
    if (effectivePrevPlan && newPlanId && effectivePrevPlan !== newPlanId) {
      return 'subscription.upgraded';
    }

    return 'subscription.updated';
  }

  /**
   * Builds snapshot input from a Stripe subscription object.
   */
  private buildSnapshot(
    orgId: string,
    subscription: Stripe.Subscription,
  ): CreateSnapshotInput {
    const priceItem = subscription.items.data[0];
    const periodStart = priceItem?.current_period_start;
    const periodEnd = priceItem?.current_period_end;

    return {
      orgId,
      stripeSubscriptionId: subscription.id,
      planId: priceItem?.price?.id ?? null,
      status: subscription.status,
      seats: priceItem?.quantity ?? null,
      seatLimit: null, // Not exposed natively by Stripe; set via product metadata if needed
      periodStart:
        periodStart == null ? new Date() : new Date(periodStart * 1000),
      periodEnd: periodEnd == null ? new Date() : new Date(periodEnd * 1000),
    };
  }

  /**
   * Synchronizes a Stripe subscription into the organization's billing record
   * and appends a SubscriptionSnapshot row in the same transaction.
   *
   * Order of operations:
   *   1. Update Organization (billing fields)      ┐ atomic transaction
   *   2. Create SubscriptionSnapshot               ┘
   *   3. Write ActivityLog
   *   4. Write LegalAuditLog
   *
   * @returns The resolved orgId if the org was found, null otherwise
   */
  async syncFromStripeSubscription(
    subscription: Stripe.Subscription,
    ctx: SyncContext,
  ): Promise<string | null> {
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;

    const org =
      await this.billingRepository.findOrgByStripeCustomerId(customerId);

    if (!org) {
      this.logger.warn(
        `No org found for Stripe customer ${customerId} — skipping sync`,
      );
      return null;
    }

    const priceItem = subscription.items.data[0];
    const newPlanId = priceItem?.price?.id ?? null;
    const newSeatCount = priceItem?.quantity ?? 1;
    const newBillingStatus = this.mapStripeBillingStatus(subscription.status);
    const previousBillingStatus =
      org.billingStatus as unknown as PrismaBillingStatus;
    const previousPlanId = org.planId;

    // In Stripe API >= 2026-xx, current_period_start/end live on SubscriptionItem
    const periodStart = priceItem?.current_period_start;
    const periodEnd = priceItem?.current_period_end;

    const billingData = {
      subscriptionId: subscription.id,
      billingStatus: newBillingStatus,
      planId: newPlanId,
      seatCount: newSeatCount,
      ...(periodStart != null && {
        subscriptionPeriodStart: new Date(periodStart * 1000),
      }),
      ...(periodEnd != null && {
        subscriptionPeriodEnd: new Date(periodEnd * 1000),
      }),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };

    const snapshotData = this.buildSnapshot(org.orgId, subscription);

    // ── 1 + 2: Transactional update ─────────────────────────────────────────
    await this.billingRepository.updateOrgAndSnapshotTx(
      org.orgId,
      billingData,
      snapshotData,
    );

    const activityAction = this.resolveActivityAction(
      ctx,
      previousPlanId,
      previousBillingStatus,
      newPlanId,
      newBillingStatus,
    );

    // ── 3: ActivityLog ───────────────────────────────────────────────────────
    await this.activityLog.logActivity({
      orgId: org.orgId,
      action: activityAction,
      entityType: 'organization',
      entityId: org.orgId,
      metadata: {
        stripeSubscriptionId: subscription.id,
        planId: newPlanId,
        status: subscription.status,
      },
    });

    // ── 4: LegalAuditLog ─────────────────────────────────────────────────────
    this.legalAudit.recordEvent({
      eventType: `billing.subscription.${ctx.eventType.replace('customer.subscription.', '')}`,
      orgId: org.orgId,
      triggerType: 'system',
      metadata: {
        stripeEventId: ctx.stripeEventId,
        stripeSubscriptionId: subscription.id,
        orgId: org.orgId,
        previousPlanId,
        newPlanId,
        status: subscription.status,
      },
    });

    this.logger.debug(
      `Synced subscription ${subscription.id} for org ${org.orgId}: ` +
        `${previousBillingStatus} → ${newBillingStatus} (${activityAction})`,
    );

    return org.orgId;
  }

  /**
   * Handles checkout.session.completed.
   *
   * Atomically persists stripeCustomerId (if not already set), subscriptionId,
   * and sets billingStatus → ACTIVE, then publishes the BILLING_CHECKOUT_COMPLETED
   * domain event so downstream consumers can react to the first successful payment.
   */
  async handleCheckoutCompleted(
    session: Stripe.Checkout.Session,
    ctx: { stripeEventId: string },
  ): Promise<void> {
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;

    if (!customerId) {
      this.logger.warn('checkout.session.completed: no customer ID in session');
      return;
    }

    const orgId = session.metadata?.['orgId'];
    if (!orgId) {
      this.logger.warn(
        'checkout.session.completed: no orgId in session metadata',
      );
      return;
    }

    const org = await this.billingRepository
      .findOrgById(orgId)
      .catch(() => null);
    if (!org) {
      this.logger.warn(
        `checkout.session.completed: org ${orgId} not found — skipping`,
      );
      return;
    }

    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription?.id ?? null);

    const updateData: {
      billingStatus: PrismaBillingStatus;
      stripeCustomerId?: string;
      subscriptionId?: string | null;
    } = { billingStatus: PrismaBillingStatus.ACTIVE };

    if (!org.stripeCustomerId) {
      updateData.stripeCustomerId = customerId;
    }
    if (subscriptionId) {
      updateData.subscriptionId = subscriptionId;
    }

    await this.billingRepository.updateOrgBillingData(orgId, updateData);

    await this.activityLog.logActivity({
      orgId,
      action: 'billing.checkout.completed',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        sessionId: session.id,
        stripeCustomerId: customerId,
        subscriptionId,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.checkout.completed',
      orgId,
      triggerType: 'system',
      metadata: {
        stripeEventId: ctx.stripeEventId,
        sessionId: session.id,
        stripeCustomerId: customerId,
        mode: session.mode,
      },
    });

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.BILLING_CHECKOUT_COMPLETED,
      timestamp: new Date(),
      payload: {
        orgId,
        stripeCustomerId: customerId,
        subscriptionId,
        sessionId: session.id,
      },
      tenantId: orgId,
      messageGroupId: orgId,
    });

    this.logger.log(
      `checkout.session.completed processed for org ${orgId}: ` +
        `customer=${customerId}, subscription=${subscriptionId ?? 'none'}`,
    );
  }

  /**
   * Handles the creation of a new subscription.
   * Syncs the subscription and dispatches a domain event.
   */
  async handleSubscriptionCreated(
    subscription: Stripe.Subscription,
    ctx: SyncContext,
  ): Promise<void> {
    const orgId = await this.syncFromStripeSubscription(subscription, ctx);

    if (!orgId) return;

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CREATED,
      timestamp: new Date(),
      payload: {
        orgId,
        subscriptionId: subscription.id,
        status: subscription.status,
        planId: subscription.items.data[0]?.price?.id,
      },
      tenantId: orgId,
      messageGroupId: orgId,
    });
  }

  /**
   * Handles updates to an existing subscription (updated, deleted, trial_will_end).
   * Syncs changes and dispatches the appropriate domain event.
   */
  async handleSubscriptionUpdated(
    subscription: Stripe.Subscription,
    ctx: SyncContext,
  ): Promise<void> {
    const orgId = await this.syncFromStripeSubscription(subscription, ctx);

    if (!orgId) return;

    const domainEvent =
      subscription.status === 'canceled'
        ? DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED
        : DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED;

    await this.eventBus.publish({
      eventType: domainEvent,
      timestamp: new Date(),
      payload: {
        orgId,
        subscriptionId: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
      tenantId: orgId,
      messageGroupId: orgId,
    });
  }

  /**
   * Handles invoice payment succeeded events.
   * Activates the subscription and dispatches a payment success event.
   */
  async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) return;

    const org =
      await this.billingRepository.findOrgByStripeCustomerId(customerId);

    if (!org) {
      this.logger.warn(`No org found for Stripe customer ${customerId}`);
      return;
    }

    await this.billingRepository.updateOrgBillingData(org.orgId, {
      billingStatus: PrismaBillingStatus.ACTIVE,
    });

    await this.activityLog.logActivity({
      orgId: org.orgId,
      action: 'invoice.payment_succeeded',
      entityType: 'organization',
      entityId: org.orgId,
      metadata: {
        invoiceId: invoice.id,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.invoice.payment_succeeded',
      orgId: org.orgId,
      triggerType: 'system',
      metadata: {
        invoiceId: invoice.id,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
      },
    });

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED,
      timestamp: new Date(),
      payload: {
        orgId: org.orgId,
        invoiceId: invoice.id,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
      },
      tenantId: org.orgId,
      messageGroupId: org.orgId,
    });
  }

  /**
   * Handles invoice payment failed events.
   * Updates billing status to PAST_DUE and dispatches a payment failure event.
   */
  async handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;

    if (!customerId) return;

    const org =
      await this.billingRepository.findOrgByStripeCustomerId(customerId);

    if (!org) {
      this.logger.warn(`No org found for Stripe customer ${customerId}`);
      return;
    }

    await this.billingRepository.updateOrgBillingData(org.orgId, {
      billingStatus: PrismaBillingStatus.PAST_DUE,
    });

    await this.activityLog.logActivity({
      orgId: org.orgId,
      action: 'invoice.payment_failed',
      entityType: 'organization',
      entityId: org.orgId,
      metadata: {
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
        currency: invoice.currency,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.invoice.payment_failed',
      orgId: org.orgId,
      triggerType: 'system',
      metadata: {
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
        newStatus: BillingStatus.PAST_DUE,
      },
    });

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.BILLING_PAYMENT_FAILED,
      timestamp: new Date(),
      payload: {
        orgId: org.orgId,
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
      },
      tenantId: org.orgId,
      messageGroupId: org.orgId,
    });
  }
}
