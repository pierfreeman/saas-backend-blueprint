import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingStatus } from '@libs/prisma-business';
import { BillingService, StripeService } from '@libs/billing';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { AdminBillingRepository } from '../../infrastructure/repositories/admin-billing.repository';
import type {
  AdminBillingOverview,
  GetPortalUrlInput,
} from '../../dto/admin-billing.dto';

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly repository: AdminBillingRepository,
    private readonly billingService: BillingService,
    private readonly stripeService: StripeService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  /**
   * Returns the full billing overview for an organization.
   *
   * @throws NotFoundException if no organization with the given ID exists.
   */
  async getBillingOverview(orgId: string): Promise<AdminBillingOverview> {
    const org = await this.repository.findOrgBillingFields(orgId);
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    return {
      orgId: org.id,
      stripeCustomerId: org.stripeCustomerId ?? null,
      subscriptionId: org.subscriptionId ?? null,
      billingStatus: org.billingStatus as BillingStatus,
      planId: org.planId ?? null,
      subscriptionPeriodStart: org.subscriptionPeriodStart ?? null,
      subscriptionPeriodEnd: org.subscriptionPeriodEnd ?? null,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
      storageLimit: org.storageLimit ?? null,
    };
  }

  /**
   * Creates a Stripe Billing Portal session for an organization and returns
   * the redirect URL. Allows the admin to manage subscriptions on behalf of
   * the tenant without logging in as a tenant user.
   *
   * @throws NotFoundException if org not found.
   * @throws BadRequestException if org has no Stripe customer ID.
   */
  async getPortalUrl(input: GetPortalUrlInput): Promise<{ url: string }> {
    const org = await this.repository.findOrgBillingFields(input.orgId);
    if (!org) {
      throw new NotFoundException(`Organization ${input.orgId} not found`);
    }
    if (!org.stripeCustomerId) {
      throw new BadRequestException(
        `Organization ${input.orgId} has no Stripe customer ID`,
      );
    }
    return this.billingService.createPortalSession(
      input.orgId,
      input.returnUrl,
      input.actorAdminId,
    );
  }

  /**
   * Changes the Stripe subscription plan for an organization.
   * Stripe fires customer.subscription.updated → SubscriptionUpdatedHandler syncs local state.
   *
   * @throws NotFoundException if the organization does not exist
   * @throws BadRequestException if the organization has no active Stripe subscription
   */
  async changePlan(
    orgId: string,
    newPriceId: string,
    actorAdminId: string,
    reason?: string,
  ): Promise<void> {
    const org = await this.repository.findOrgBillingFields(orgId);
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }
    if (!org.subscriptionId) {
      throw new BadRequestException(
        `Organization ${orgId} has no active Stripe subscription`,
      );
    }

    await this.stripeService.updateSubscriptionPlan(
      org.subscriptionId,
      newPriceId,
    );

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId,
      action: 'billing.plan.changed',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        previousPlanId: org.planId ?? null,
        newPriceId,
        reason: reason ?? null,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.plan.changed',
      orgId,
      triggerType: 'admin_action',
      metadata: {
        actorAdminId,
        previousPlanId: org.planId ?? null,
        newPriceId,
        subscriptionId: org.subscriptionId,
        reason: reason ?? null,
      },
    });
  }

  /**
   * Extends (or sets) the Stripe trial end date for an organization.
   * Only valid when the organization has a TRIALING subscription.
   * Stripe fires customer.subscription.updated → SubscriptionUpdatedHandler syncs subscriptionPeriodEnd.
   *
   * @throws NotFoundException if the organization does not exist
   * @throws BadRequestException if org has no subscription or is not in TRIALING status
   */
  async extendTrial(
    orgId: string,
    trialEnd: Date,
    actorAdminId: string,
  ): Promise<void> {
    const org = await this.repository.findOrgBillingFields(orgId);
    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }
    if (!org.subscriptionId) {
      throw new BadRequestException(
        `Organization ${orgId} has no active Stripe subscription`,
      );
    }
    if (org.billingStatus !== BillingStatus.TRIALING) {
      throw new BadRequestException(
        `Organization ${orgId} is not in TRIALING status (current: ${org.billingStatus})`,
      );
    }

    await this.stripeService.extendTrial(org.subscriptionId, trialEnd);

    this.activityLog.logActivity({
      orgId,
      actorId: actorAdminId,
      action: 'billing.trial.extended',
      entityType: 'organization',
      entityId: orgId,
      metadata: { trialEnd: trialEnd.toISOString() },
    });

    this.legalAudit.recordEvent({
      eventType: 'billing.trial.extended',
      orgId,
      triggerType: 'admin_action',
      metadata: {
        actorAdminId,
        trialEnd: trialEnd.toISOString(),
        subscriptionId: org.subscriptionId,
      },
    });
  }
}
