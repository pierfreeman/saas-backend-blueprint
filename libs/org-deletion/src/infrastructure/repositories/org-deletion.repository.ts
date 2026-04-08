import {
  Organization,
  OrganizationStatus,
  PrismaBusinessService,
} from '@libs/prisma-business';
import { Injectable } from '@nestjs/common';

export interface OrgDeletionRecord {
  id: string;
  name: string;
  status: OrganizationStatus;
  retentionPeriodDays: number | null;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
}

export interface MarkPendingDeletionInput {
  deletionRequestedAt: Date;
  deletionScheduledAt: Date;
}

/**
 * OrgDeletionRepository
 *
 * Isolates all database operations required by the organisation deletion domain.
 * Services inject this repository instead of PrismaBusinessService directly.
 */
@Injectable()
export class OrgDeletionRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findOrgById(orgId: string): Promise<OrgDeletionRecord | null> {
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        status: true,
        retentionPeriodDays: true,
        stripeCustomerId: true,
        subscriptionId: true,
      },
    });
  }

  /**
   * Find organisations eligible for deletion: status SUSPENDED and past their
   * scheduled deletion date. Used by the scheduler cron job.
   */
  async findOrgsEligibleForDeletion(now: Date): Promise<Organization[]> {
    return this.prisma.organization.findMany({
      where: {
        status: 'SUSPENDED',
        deletionScheduledAt: { lte: now },
      },
    });
  }

  /**
   * Find SUSPENDED organisations whose subscriptionPeriodEnd is in the past.
   * Used by OrgDeletionService to determine which orgs have crossed their
   * retention window and should be queued for deletion.
   */
  async findSuspendedOrgsWithExpiredSubscriptions(now: Date): Promise<
    Array<{
      id: string;
      name: string;
      subscriptionPeriodEnd: Date;
      retentionPeriodDays: number | null;
    }>
  > {
    return this.prisma.organization.findMany({
      where: {
        status: OrganizationStatus.SUSPENDED,
        subscriptionPeriodEnd: { not: null, lt: now },
      },
      select: {
        id: true,
        name: true,
        subscriptionPeriodEnd: true,
        retentionPeriodDays: true,
      },
    }) as Promise<
      Array<{
        id: string;
        name: string;
        subscriptionPeriodEnd: Date;
        retentionPeriodDays: number | null;
      }>
    >;
  }

  async markPendingDeletion(
    orgId: string,
    input: MarkPendingDeletionInput,
  ): Promise<void> {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        status: OrganizationStatus.PENDING_DELETION,
        deletionRequestedAt: input.deletionRequestedAt,
        deletionScheduledAt: input.deletionScheduledAt,
      },
    });
  }

  async markDeleted(orgId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        status: OrganizationStatus.DELETED,
        deletionCompletedAt: new Date(),
      },
    });
  }

  async findUserByAuth0Id(auth0Id: string): Promise<{ email: string } | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id },
      select: { email: true },
    });
  }

  /**
   * Delete all child records of an organisation in a single atomic transaction.
   * Cascade-delete is handled here rather than relying on DB-level cascades so
   * that the deletion order is explicit and auditable.
   */
  async deleteDatabaseRecords(orgId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionSnapshot.deleteMany({ where: { orgId } });
      await tx.event.deleteMany({ where: { orgId } });
      await tx.file.deleteMany({ where: { orgId } });
      await tx.notification.deleteMany({ where: { orgId } });
      await tx.orgExport.deleteMany({ where: { orgId } });
      await tx.job.deleteMany({ where: { orgId } });
      await tx.activityLog.deleteMany({ where: { orgId } });
      await tx.membership.deleteMany({ where: { orgId } });
    });
  }
}
