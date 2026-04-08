import {
  BillingStatus,
  MembershipRole,
  MembershipStatus,
  PrismaBusinessService,
} from '@libs/prisma-business';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';
import { BillingStatus as DomainBillingStatus } from '../../domain/enums/billing-status.enum';

export interface SubscriptionSnapshotItem {
  id: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: string;
  seats: number | null;
  seatLimit: number | null;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
}

export interface CreateSnapshotInput {
  orgId: string;
  stripeSubscriptionId: string;
  planId: string | null;
  status: string;
  seats: number | null;
  seatLimit: number | null;
  periodStart: Date;
  periodEnd: Date;
}

export interface UpdateBillingDataInput {
  stripeCustomerId?: string;
  subscriptionId?: string | null;
  billingStatus?: BillingStatus;
  planId?: string | null;
  storageLimit?: bigint | null;
  subscriptionPeriodStart?: Date | null;
  subscriptionPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

/**
 * BillingRepository
 * Data-access layer for all billing-related database operations.
 *
 * Abstracts all Prisma calls related to Organization billing fields
 * and the BillingEvent idempotency table.
 */
@Injectable()
export class BillingRepository {
  private readonly logger = new Logger(BillingRepository.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Finds an organization by its internal ID and returns billing fields.
   * Throws NotFoundException if the organization does not exist.
   */
  async findOrgById(orgId: string): Promise<SubscriptionEntity> {
    const org = await this.prisma.organization.findUnique({
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

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    return {
      orgId,
      stripeCustomerId: org.stripeCustomerId,
      subscriptionId: org.subscriptionId,
      billingStatus: org.billingStatus as unknown as DomainBillingStatus,
      planId: org.planId,
      storageLimit: org.storageLimit,
      subscriptionPeriodStart: org.subscriptionPeriodStart,
      subscriptionPeriodEnd: org.subscriptionPeriodEnd,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    };
  }

  /**
   * Returns the display name and OWNER email for an organization.
   * Used to lazily provision a Stripe customer on first billing action.
   * Falls back to `null` for ownerEmail if no OWNER membership is found.
   */
  async findOrgMeta(
    orgId: string,
  ): Promise<{ name: string; ownerEmail: string | null }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        memberships: {
          where: {
            role: MembershipRole.OWNER,
            status: MembershipStatus.ACTIVE,
          },
          take: 1,
          select: { user: { select: { email: true } } },
        },
      },
    });

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    const ownerEmail = org.memberships[0]?.user?.email ?? null;
    return { name: org.name, ownerEmail };
  }

  /**
   * Finds an organization by its Stripe customer ID.
   * Returns null if no organization is associated with this customer.
   */
  async findOrgByStripeCustomerId(
    customerId: string,
  ): Promise<SubscriptionEntity | null> {
    const org = await this.prisma.organization.findUnique({
      where: { stripeCustomerId: customerId },
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

    if (!org) {
      return null;
    }

    return {
      orgId: org.id,
      stripeCustomerId: org.stripeCustomerId,
      subscriptionId: org.subscriptionId,
      billingStatus: org.billingStatus as unknown as DomainBillingStatus,
      planId: org.planId,
      storageLimit: org.storageLimit,
      subscriptionPeriodStart: org.subscriptionPeriodStart,
      subscriptionPeriodEnd: org.subscriptionPeriodEnd,
      cancelAtPeriodEnd: org.cancelAtPeriodEnd,
    };
  }

  /**
   * Updates billing-specific fields on an Organization record.
   */
  async updateOrgBillingData(
    orgId: string,
    data: UpdateBillingDataInput,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.stripeCustomerId !== undefined && {
          stripeCustomerId: data.stripeCustomerId,
        }),
        ...(data.subscriptionId !== undefined && {
          subscriptionId: data.subscriptionId,
        }),
        ...(data.billingStatus !== undefined && {
          billingStatus: data.billingStatus,
        }),
        ...(data.planId !== undefined && { planId: data.planId }),
        ...(data.storageLimit !== undefined && {
          storageLimit: data.storageLimit,
        }),
        ...(data.subscriptionPeriodStart !== undefined && {
          subscriptionPeriodStart: data.subscriptionPeriodStart,
        }),
        ...(data.subscriptionPeriodEnd !== undefined && {
          subscriptionPeriodEnd: data.subscriptionPeriodEnd,
        }),
        ...(data.cancelAtPeriodEnd !== undefined && {
          cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        }),
      },
    });

    this.logger.debug(`Updated billing data for org ${orgId}`);
  }

  /**
   * Creates a subscription snapshot inside an existing Prisma transaction.
   * Appends an immutable point-in-time record of subscription state.
   */
  async createSubscriptionSnapshot(input: CreateSnapshotInput): Promise<void> {
    await this.prisma.subscriptionSnapshot.create({
      data: {
        orgId: input.orgId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        planId: input.planId,
        status: input.status,
        seats: input.seats,
        seatLimit: input.seatLimit,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
    });
    this.logger.debug(
      `Snapshot created for subscription ${input.stripeSubscriptionId} (org ${input.orgId})`,
    );
  }

  /**
   * Atomically updates Organization billing fields and appends a SubscriptionSnapshot.
   * Both writes occur inside a single Prisma transaction to guarantee consistency.
   */
  async updateOrgAndSnapshotTx(
    orgId: string,
    billing: UpdateBillingDataInput,
    snapshot: CreateSnapshotInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: orgId },
        data: {
          ...(billing.stripeCustomerId !== undefined && {
            stripeCustomerId: billing.stripeCustomerId,
          }),
          ...(billing.subscriptionId !== undefined && {
            subscriptionId: billing.subscriptionId,
          }),
          ...(billing.billingStatus !== undefined && {
            billingStatus: billing.billingStatus,
          }),
          ...(billing.planId !== undefined && { planId: billing.planId }),
          ...(billing.storageLimit !== undefined && {
            storageLimit: billing.storageLimit,
          }),
          ...(billing.subscriptionPeriodStart !== undefined && {
            subscriptionPeriodStart: billing.subscriptionPeriodStart,
          }),
          ...(billing.subscriptionPeriodEnd !== undefined && {
            subscriptionPeriodEnd: billing.subscriptionPeriodEnd,
          }),
          ...(billing.cancelAtPeriodEnd !== undefined && {
            cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
          }),
        },
      });

      await tx.subscriptionSnapshot.create({
        data: {
          orgId: snapshot.orgId,
          stripeSubscriptionId: snapshot.stripeSubscriptionId,
          planId: snapshot.planId,
          status: snapshot.status,
          seats: snapshot.seats,
          seatLimit: snapshot.seatLimit,
          periodStart: snapshot.periodStart,
          periodEnd: snapshot.periodEnd,
        },
      });
    });

    this.logger.debug(
      `Transactional update: org ${orgId} + snapshot for sub ${snapshot.stripeSubscriptionId}`,
    );
  }

  /**
   * Returns a paginated, newest-first list of SubscriptionSnapshots for an org.
   * Also returns the total count for pagination metadata.
   */
  async findSnapshotsByOrgId(
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<{ items: SubscriptionSnapshotItem[]; total: number }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscriptionSnapshot.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          stripeSubscriptionId: true,
          planId: true,
          status: true,
          seats: true,
          seatLimit: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
        },
      }),
      this.prisma.subscriptionSnapshot.count({ where: { orgId } }),
    ]);
    return { items, total };
  }

  /**
   * Checks whether a Stripe event has already been processed (idempotency check).
   * Returns the existing record if found, null otherwise.
   */
  async findBillingEvent(
    stripeEventId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.billingEvent.findUnique({
      where: { stripeEventId },
      select: { id: true },
    });
  }

  /**
   * Records a processed Stripe event to prevent duplicate processing.
   * Silently ignores unique-constraint violations (race condition safety).
   */
  async createBillingEvent(
    stripeEventId: string,
    payloadHash: string,
    orgId?: string,
  ): Promise<void> {
    try {
      await this.prisma.billingEvent.create({
        data: {
          stripeEventId,
          processedAt: new Date(),
          payloadHash,
          ...(orgId ? { orgId } : {}),
        },
      });
    } catch (err: unknown) {
      // Unique constraint violation = already processed (race condition)
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Unique constraint')) {
        this.logger.warn(
          `Stripe event ${stripeEventId} was already recorded (race condition)`,
        );
        return;
      }
      throw err;
    }
  }

  /**
   * Returns the minimal billing snapshot needed for entitlement checks.
   * Returns null if the organisation does not exist.
   */
  async getOrgBillingStatus(orgId: string): Promise<{
    planId: string | null;
    billingStatus: BillingStatus;
    storageLimit: bigint | null;
  } | null> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { planId: true, billingStatus: true, storageLimit: true },
    });
    if (!org) {
      return null;
    }
    return {
      planId: org.planId,
      billingStatus: org.billingStatus,
      storageLimit: org.storageLimit,
    };
  }
}
