import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingStatus } from '@libs/prisma-business';
import { BillingService } from '@libs/billing';
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
   * @throws NotFoundException (propagated from BillingService) if org not found.
   */
  async getPortalUrl(input: GetPortalUrlInput): Promise<{ url: string }> {
    return this.billingService.createPortalSession(
      input.orgId,
      input.returnUrl,
      input.actorAdminId,
    );
  }
}
