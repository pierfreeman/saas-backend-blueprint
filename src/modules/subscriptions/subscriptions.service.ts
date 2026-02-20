import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { EventBusService } from '../../events/event-bus.service';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly priceIdPro: string;
  private readonly priceIdEnterprise: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly configService: ConfigService,
  ) {
    this.priceIdPro = this.configService.get<string>('stripe.priceIdPro') || '';
    this.priceIdEnterprise = this.configService.get<string>('stripe.priceIdEnterprise') || '';
  }

  async findByOrgId(orgId: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({
      where: { orgId },
    });
  }

  async createOrUpdateFromStripe(stripeSubscription: Stripe.Subscription): Promise<Subscription> {
    const customerId =
      typeof stripeSubscription.customer === 'string'
        ? stripeSubscription.customer
        : stripeSubscription.customer.id;

    // Find organization by Stripe customer ID
    const organization = await this.prisma.organization.findUnique({
      where: { stripeCustomerId: customerId },
    });

    if (!organization) {
      throw new Error(`Organization not found for Stripe customer ${customerId}`);
    }

    const plan = this.mapStripePlanToPlan(stripeSubscription);
    const status = this.mapStripeStatusToStatus(stripeSubscription.status);

    this.logger.log(
      `Updating subscription for organization ${organization.id}: plan=${plan}, status=${status}`,
    );

    const subscription = await this.prisma.subscription.upsert({
      where: { orgId: organization.id },
      create: {
        orgId: organization.id,
        stripeSubscriptionId: stripeSubscription.id,
        plan,
        status,
        currentPeriodEnd: new Date((stripeSubscription as any).current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
      update: {
        stripeSubscriptionId: stripeSubscription.id,
        plan,
        status,
        currentPeriodEnd: new Date((stripeSubscription as any).current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      },
    });

    // Emit subscription updated event
    this.eventBus.emit({
      eventType: 'subscription.updated',
      timestamp: new Date(),
      organizationId: organization.id,
      payload: {
        subscriptionId: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        stripeSubscriptionId: stripeSubscription.id,
      },
    });

    return subscription;
  }

  async handleStripeWebhook(event: Stripe.Event): Promise<void> {
    this.logger.log(`Processing webhook event: ${event.type}`);

    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await this.createOrUpdateFromStripe(event.data.object as Stripe.Subscription);
          break;

        case 'checkout.session.completed':
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            this.logger.log(`Checkout completed for session ${session.id}`);
          }
          break;

        default:
          this.logger.debug(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      this.logger.error(
        `Error processing webhook event ${event.type}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }

  private mapStripePlanToPlan(subscription: Stripe.Subscription): SubscriptionPlan {
    // Extract price ID from subscription items
    const priceId = subscription.items.data[0]?.price.id;

    if (!priceId) {
      return SubscriptionPlan.FREE;
    }

    // Map price IDs to plans using environment variables
    if (priceId === this.priceIdEnterprise) {
      return SubscriptionPlan.ENTERPRISE;
    } else if (priceId === this.priceIdPro) {
      return SubscriptionPlan.PRO;
    }

    this.logger.warn(`Unknown price ID: ${priceId}, defaulting to FREE`);
    return SubscriptionPlan.FREE;
  }

  private mapStripeStatusToStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
    const statusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELED,
      incomplete: SubscriptionStatus.INCOMPLETE,
      incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
      trialing: SubscriptionStatus.TRIALING,
      unpaid: SubscriptionStatus.UNPAID,
      paused: SubscriptionStatus.ACTIVE, // Map paused to active
    };

    return statusMap[stripeStatus] || SubscriptionStatus.CANCELED;
  }
}
