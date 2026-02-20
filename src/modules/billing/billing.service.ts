import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeService } from './stripe.service';
import { Organization } from '@prisma/client';
import Stripe from 'stripe';
import { EventBusService } from '../../events/event-bus.service';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly eventBus: EventBusService,
  ) {}

  async createStripeCustomer(organization: Organization): Promise<string> {
    if (organization.stripeCustomerId) {
      this.logger.warn(`Organization ${organization.id} already has a Stripe customer`);
      return organization.stripeCustomerId;
    }

    this.logger.log(`Creating Stripe customer for organization ${organization.id}`);

    const customer = await this.stripeService.createCustomer({
      email: `org-${organization.id}@placeholder.com`,
      name: organization.name,
      metadata: {
        organizationId: organization.id,
      },
    });

    await this.prisma.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    });

    this.logger.log(`Stripe customer ${customer.id} created for organization ${organization.id}`);

    return customer.id;
  }

  async getOrCreateStripeCustomer(orgId: string): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (organization.stripeCustomerId) {
      return organization.stripeCustomerId;
    }

    return this.createStripeCustomer(organization);
  }

  async createCheckoutSession(
    orgId: string,
    priceId: string,
    successUrl?: string,
    cancelUrl?: string,
    userId?: string,
  ): Promise<Stripe.Checkout.Session> {
    const customerId = await this.getOrCreateStripeCustomer(orgId);

    const defaultSuccessUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const defaultCancelUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing/cancel`;

    const session = await this.stripeService.createCheckoutSession({
      customerId,
      priceId,
      successUrl: successUrl || defaultSuccessUrl,
      cancelUrl: cancelUrl || defaultCancelUrl,
      metadata: {
        organizationId: orgId,
      },
    });

    // Emit billing checkout event
    this.eventBus.emit({
      eventType: 'billing.checkout.created',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        sessionId: session.id,
        priceId,
        customerId,
        amount: session.amount_total,
        currency: session.currency,
      },
    });

    this.logger.log(`Checkout session ${session.id} created for organization ${orgId}`);

    return session;
  }

  async createBillingPortalSession(
    orgId: string,
    returnUrl?: string,
    userId?: string,
  ): Promise<Stripe.BillingPortal.Session> {
    const customerId = await this.getOrCreateStripeCustomer(orgId);

    const defaultReturnUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/billing`;

    const session = await this.stripeService.createBillingPortalSession({
      customerId,
      returnUrl: returnUrl || defaultReturnUrl,
    });

    // Emit billing portal event
    this.eventBus.emit({
      eventType: 'billing.portal.created',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        sessionId: session.id,
        customerId,
        returnUrl: session.return_url,
      },
    });

    this.logger.log(`Billing portal session created for organization ${orgId}`);

    return session;
  }

  async cancelSubscription(
    orgId: string,
    cancelAtPeriodEnd = true,
    userId?: string,
  ): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('Active subscription not found');
    }

    await this.stripeService.cancelSubscription(
      subscription.stripeSubscriptionId,
      cancelAtPeriodEnd,
    );

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd },
    });

    // Emit billing subscription cancelled event
    this.eventBus.emit({
      eventType: 'billing.subscription.cancelled',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        cancelAtPeriodEnd,
        cancelledAt: new Date().toISOString(),
      },
    });

    this.logger.log(
      `Subscription ${subscription.id} ${cancelAtPeriodEnd ? 'scheduled for cancellation' : 'cancelled immediately'}`,
    );
  }

  async reactivateSubscription(orgId: string, userId?: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new NotFoundException('Active subscription not found');
    }

    if (!subscription.cancelAtPeriodEnd) {
      throw new BadRequestException('Subscription is not scheduled for cancellation');
    }

    await this.stripeService.reactivateSubscription(subscription.stripeSubscriptionId);

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false },
    });

    // Emit billing subscription reactivated event
    this.eventBus.emit({
      eventType: 'billing.subscription.reactivated',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        reactivatedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Subscription ${subscription.id} reactivated`);
  }
}
