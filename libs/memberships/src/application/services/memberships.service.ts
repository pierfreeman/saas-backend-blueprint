import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { Membership, MembershipRole, Organization, User } from '@libs/prisma-business';
import { MembershipsRepository } from '../../infrastructure/repositories/memberships.repository';
import {
  IMembershipCacheNotifier,
  MEMBERSHIP_CACHE_NOTIFIER,
} from '../../membership-cache-notifier.token';
import {
  ISeatLimitProvider,
  SEAT_LIMIT_PROVIDER,
} from '../../seat-limit-provider.token';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly repo: MembershipsRepository,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    @Optional()
    @Inject(MEMBERSHIP_CACHE_NOTIFIER)
    private readonly cacheNotifier?: IMembershipCacheNotifier,
    @Optional()
    @Inject(SEAT_LIMIT_PROVIDER)
    private readonly seatLimitProvider?: ISeatLimitProvider,
  ) {}

  private async checkSeatLimit(orgId: string): Promise<void> {
    if (!this.seatLimitProvider) return;

    const maxSeats = await this.seatLimitProvider.getMaxSeats(orgId);
    const activeMemberCount = await this.repo.countActive(orgId);

    if (activeMemberCount >= maxSeats) {
      throw new ForbiddenException(
        `Seat limit reached (${maxSeats}). Upgrade your plan to add more members.`,
      );
    }
  }

  async createMembership(
    orgId: string,
    dto: { userId: string; role: MembershipRole },
    actorUserId?: string,
  ): Promise<Membership> {
    await this.checkSeatLimit(orgId);

    this.logger.log(
      `Adding user ${dto.userId} to org ${orgId} with role ${dto.role}`,
    );

    const membership = await this.repo.create({
      userId: dto.userId,
      orgId,
      role: dto.role,
    });

    await this.cacheNotifier?.invalidate(dto.userId, orgId);

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId ?? null,
      action: 'membership.created',
      entityType: 'membership',
      entityId: membership.id,
      metadata: { targetUserId: dto.userId, role: dto.role },
    });

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

  async findByOrg(orgId: string): Promise<(Membership & { user: User })[]> {
    return this.repo.findByOrg(orgId);
  }

  async findById(id: string): Promise<Membership | null> {
    return this.repo.findById(id);
  }

  async findByUser(
    userId: string,
  ): Promise<(Membership & { organization: Organization })[]> {
    return this.repo.findByUser(userId);
  }

  async findByUserAndOrg(
    userId: string,
    orgId: string,
  ): Promise<Membership | null> {
    return this.repo.findByUserAndOrg(userId, orgId);
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
    dto: { role: MembershipRole },
    actorUserId?: string,
  ): Promise<Membership> {
    const membership = await this.repo.findById(id);

    if (membership?.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    const previousRole = membership.role;
    const updated = await this.repo.update(id, { role: dto.role });

    await this.cacheNotifier?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} updated to role ${dto.role}`);

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
    const membership = await this.repo.findById(id);

    if (membership?.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    await this.repo.delete(id);
    await this.cacheNotifier?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} deleted`);

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId ?? null,
      action: 'membership.deleted',
      entityType: 'membership',
      entityId: id,
      metadata: { targetUserId: membership.userId, role: membership.role },
    });

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
