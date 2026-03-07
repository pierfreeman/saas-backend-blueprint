import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { StripeService } from '../../infrastructure/stripe/stripe.service';
import {
  BillingRepository,
  SubscriptionSnapshotItem,
} from '../../infrastructure/repositories/billing.repository';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';

/**
 * BillingService
 * Application service orchestrating billing operations exposed via HTTP.
 *
 * Responsibilities:
 *  - Ensure a Stripe customer exists for an organization
 *  - Create Stripe Checkout and Billing Portal sessions
 *  - Read and cancel subscriptions
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly stripeService: StripeService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Ensures a Stripe customer exists for the given organization.
   * Creates one if absent and persists the stripeCustomerId on the org record.
   *
   * @returns The Stripe customer ID
   */
  async ensureStripeCustomer(
    orgId: string,
    ownerEmail: string,
    orgName: string,
  ): Promise<string> {
    const org = await this.billingRepository.findOrgById(orgId);

    if (org.stripeCustomerId) {
      return org.stripeCustomerId;
    }

    this.logger.log(`Creating Stripe customer for org ${orgId}`);

    const customer = await this.stripeService.createCustomer(
      ownerEmail,
      orgName,
      {
        orgId,
      },
    );

    await this.billingRepository.updateOrgBillingData(orgId, {
      stripeCustomerId: customer.id,
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.customer.created',
      orgId,
      triggerType: 'user_action',
      metadata: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  /**
   * Creates a Stripe Checkout Session for subscription purchase.
   * The user is redirected to the returned URL to complete payment.
   *
   * @returns { url: string, sessionId: string }
   */
  async createCheckoutSession(
    orgId: string,
    priceId: string,
    actorUserId: string,
    options: { successUrl?: string; cancelUrl?: string } = {},
  ): Promise<{ url: string; sessionId: string }> {
    const org = await this.billingRepository.findOrgById(orgId);

    if (!org.stripeCustomerId) {
      throw new BadRequestException(
        'Organization does not have a Stripe customer. Call ensureStripeCustomer first.',
      );
    }

    const defaultSuccessUrl =
      this.configService.get<string>('BILLING_SUCCESS_URL') ??
      'http://localhost:3000/billing/success';
    const defaultCancelUrl =
      this.configService.get<string>('BILLING_CANCEL_URL') ??
      'http://localhost:3000/billing/cancel';

    const session = await this.stripeService.createCheckoutSession({
      customerId: org.stripeCustomerId,
      priceId,
      successUrl: options.successUrl ?? defaultSuccessUrl,
      cancelUrl: options.cancelUrl ?? defaultCancelUrl,
      metadata: { orgId },
    });

    if (!session.url) {
      throw new BadRequestException('Failed to generate checkout URL');
    }

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'billing.checkout.created',
      entityType: 'organization',
      entityId: orgId,
      metadata: { priceId, sessionId: session.id },
    });

    this.logger.log(`Checkout session created for org ${orgId}: ${session.id}`);

    return { url: session.url, sessionId: session.id };
  }

  /**
   * Creates a Stripe Billing Portal session.
   * The returned URL allows the customer to manage their subscription.
   *
   * @returns { url: string }
   */
  async createPortalSession(
    orgId: string,
    returnUrl: string | undefined,
    actorUserId: string,
  ): Promise<{ url: string }> {
    const org = await this.billingRepository.findOrgById(orgId);

    if (!org.stripeCustomerId) {
      throw new BadRequestException(
        'Organization does not have a Stripe customer. Cannot access billing portal.',
      );
    }

    const defaultReturnUrl =
      this.configService.get<string>('BILLING_RETURN_URL') ??
      'http://localhost:3000/billing';

    const session = await this.stripeService.createPortalSession(
      org.stripeCustomerId,
      returnUrl ?? defaultReturnUrl,
    );

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'billing.portal.accessed',
      entityType: 'organization',
      entityId: orgId,
      metadata: {},
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.portal.session_created',
      orgId,
      triggerType: 'user_action',
      metadata: { actorUserId },
    });

    this.logger.log(`Portal session created for org ${orgId}`);

    return { url: session.url };
  }

  /**
   * Returns the current subscription state for an organization.
   */
  async getSubscription(orgId: string): Promise<SubscriptionEntity> {
    return this.billingRepository.findOrgById(orgId);
  }

  /**
   * Returns a paginated history of SubscriptionSnapshots for an organization.
   * Snapshots are ordered newest-first and represent audit checkpoints written
   * for each Stripe subscription lifecycle event.
   */
  async getSubscriptionHistory(
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SubscriptionSnapshotItem[]; total: number }> {
    await this.billingRepository.findOrgById(orgId); // validates org exists
    return this.billingRepository.findSnapshotsByOrgId(orgId, limit, offset);
  }

  /**
   * Cancels the active subscription at the end of the current billing period.
   * Sets cancel_at_period_end = true on Stripe and updates the DB.
   */
  async cancelSubscription(orgId: string, actorUserId: string): Promise<void> {
    const org = await this.billingRepository.findOrgById(orgId);

    if (!org.subscriptionId) {
      throw new NotFoundException('Organization has no active subscription');
    }

    await this.stripeService.cancelSubscription(org.subscriptionId);

    await this.billingRepository.updateOrgBillingData(orgId, {
      cancelAtPeriodEnd: true,
    });

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'subscription.canceled',
      entityType: 'organization',
      entityId: orgId,
      metadata: { subscriptionId: org.subscriptionId },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.subscription.state_change',
      orgId,
      triggerType: 'user_action',
      metadata: {
        previousStatus: org.billingStatus,
        action: 'cancel_at_period_end',
        subscriptionId: org.subscriptionId,
        actorUserId,
      },
    });

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
      timestamp: new Date(),
      payload: { orgId, subscriptionId: org.subscriptionId },
      tenantId: orgId,
      messageGroupId: orgId,
    });

    this.logger.log(
      `Subscription ${org.subscriptionId} scheduled for cancellation (org: ${orgId})`,
    );
  }
}
