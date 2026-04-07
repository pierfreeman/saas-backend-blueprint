import { Organization, PrismaBusinessService } from '@libs/prisma-business';
import { Injectable } from '@nestjs/common';

type OrgBillingFields = Pick<
  Organization,
  | 'id'
  | 'stripeCustomerId'
  | 'subscriptionId'
  | 'billingStatus'
  | 'planId'
  | 'storageLimit'
  | 'subscriptionPeriodStart'
  | 'subscriptionPeriodEnd'
  | 'cancelAtPeriodEnd'
>;

@Injectable()
export class AdminBillingRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findOrgBillingFields(orgId: string): Promise<OrgBillingFields | null> {
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        stripeCustomerId: true,
        subscriptionId: true,
        billingStatus: true,
        planId: true,
        storageLimit: true,
        subscriptionPeriodStart: true,
        subscriptionPeriodEnd: true,
        cancelAtPeriodEnd: true,
      },
    });
  }
}
