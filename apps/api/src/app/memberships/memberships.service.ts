import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import {
  BillingStatus,
  Membership,
  MembershipRole,
  MembershipStatus,
} from '@prisma/client';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { RBACCacheService } from '../rbac/services/rbac-cache.service';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    @Optional()
    @Inject(forwardRef(() => RBACCacheService))
    private readonly rbacCache?: RBACCacheService,
  ) {}

  /**
   * Checks whether the organization has capacity for a new member.
   * Enforced only when the org has a non-free billing status (i.e. an active
   * or trialing Stripe subscription).  Free-tier orgs (NONE) are exempt.
   *
   * Counts memberships with status ACTIVE or INVITED against Organization.seatCount.
   * Throws ForbiddenException when the limit is reached.
   */
  private async checkSeatLimit(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { billingStatus: true, seatCount: true },
    });

    // Free tier or org not found — no limit to enforce.
    if (!org || org.billingStatus === BillingStatus.NONE) return;

    const activeMemberCount = await this.prisma.membership.count({
      where: {
        orgId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
      },
    });

    if (activeMemberCount >= org.seatCount) {
      throw new ForbiddenException(
        `Seat limit reached (${org.seatCount}). Upgrade your plan to add more members.`,
      );
    }
  }

  async createMembership(
    orgId: string,
    dto: CreateMembershipDto,
    actorUserId?: string,
  ): Promise<Membership> {
    await this.checkSeatLimit(orgId);

    this.logger.log(
      `Adding user ${dto.userId} to org ${orgId} with role ${dto.role}`,
    );

    const membership = await this.prisma.membership.create({
      data: { userId: dto.userId, orgId, role: dto.role },
    });

    await this.rbacCache?.invalidate(dto.userId, orgId);

    // ISO 27001 A.9.2 - business activity log (access provisioning)
    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId ?? null,
      action: 'membership.created',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { targetUserId: dto.userId, role: dto.role },
    });

    // ISO 27001 A.9.2 - legal compliance record
    this.legalAudit.recordEvent({
      eventType: 'membership.created',
      orgId,
      triggerType: 'user',
      metadata: {
        membershipId: membership.id,
        targetUserId: dto.userId,
        role: dto.role,
        actorUserId: actorUserId ?? null,
      },
    });

    return membership;
  }

  async findByOrg(orgId: string): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: { orgId },
      include: { user: true },
    });
  }

  async findByUser(userId: string): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
    });
  }

  async findByUserAndOrg(
    userId: string,
    orgId: string,
  ): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
  }

  async getMembershipOrThrow(
    userId: string,
    orgId: string,
  ): Promise<Membership> {
    const membership = await this.findByUserAndOrg(userId, orgId);
    if (!membership) {
      throw new ForbiddenException(
        'You do not have access to this organization',
      );
    }
    return membership;
  }

  async updateMembership(
    id: string,
    orgId: string,
    dto: UpdateMembershipDto,
    actorUserId?: string,
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({
      where: { id },
    });

    if (membership?.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    const previousRole = membership.role;
    const updated = await this.prisma.membership.update({
      where: { id },
      data: { role: dto.role },
    });

    await this.rbacCache?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} updated to role ${dto.role}`);

    // ISO 27001 A.9.2 - business activity log (privilege change)
    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId ?? null,
      action: 'membership.role_changed',
      entityType: 'membership',
      entityId: id,
      metadata: {
        targetUserId: membership.userId,
        previousRole,
        newRole: dto.role,
      },
    });

    // ISO 27001 A.9.2 - legal compliance record (privilege change)
    this.legalAudit.recordEvent({
      eventType: 'membership.role_changed',
      orgId,
      triggerType: 'user',
      metadata: {
        membershipId: id,
        targetUserId: membership.userId,
        previousRole,
        newRole: dto.role,
        actorUserId: actorUserId ?? null,
      },
    });

    return updated;
  }

  async deleteMembership(
    id: string,
    orgId: string,
    actorUserId?: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { id },
    });

    if (membership?.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.membership.delete({ where: { id } });
    await this.rbacCache?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} deleted`);

    // ISO 27001 A.9.2 - business activity log (access revocation)
    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId ?? null,
      action: 'membership.deleted',
      entityType: 'membership',
      entityId: id,
      metadata: { targetUserId: membership.userId, role: membership.role },
    });

    // ISO 27001 A.9.2 - legal compliance record (access revocation)
    this.legalAudit.recordEvent({
      eventType: 'membership.deleted',
      orgId,
      triggerType: 'user',
      metadata: {
        membershipId: id,
        targetUserId: membership.userId,
        role: membership.role,
        actorUserId: actorUserId ?? null,
      },
    });
  }

  async hasRole(
    userId: string,
    orgId: string,
    roles: MembershipRole[],
  ): Promise<boolean> {
    const membership = await this.findByUserAndOrg(userId, orgId);
    return !!membership && roles.includes(membership.role);
  }

  async isOwner(userId: string, orgId: string): Promise<boolean> {
    return this.hasRole(userId, orgId, [MembershipRole.OWNER]);
  }

  async isAdmin(userId: string, orgId: string): Promise<boolean> {
    return this.hasRole(userId, orgId, [
      MembershipRole.OWNER,
      MembershipRole.ADMIN,
    ]);
  }
}
