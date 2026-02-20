import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Membership, MembershipRole } from '@prisma/client';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { EventBusService } from '../../events/event-bus.service';

// Lazy import to avoid circular dependency
let RBACCacheService: any;

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);
  private rbacCacheService: any;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Set RBAC cache service (optional, for cache invalidation)
   */
  setRBACCacheService(cacheService: any) {
    this.rbacCacheService = cacheService;
  }

  private async invalidateRBACCache(userId: string, orgId: string): Promise<void> {
    if (this.rbacCacheService) {
      await this.rbacCacheService.invalidate(userId, orgId);
    }
  }

  async createMembership(dto: CreateMembershipDto): Promise<Membership> {
    this.logger.log(
      `Creating membership for user ${dto.userId} in org ${dto.orgId} with role ${dto.role}`,
    );

    const membership = await this.prisma.membership.create({
      data: {
        userId: dto.userId,
        orgId: dto.orgId,
        role: dto.role,
      },
    });

    // Invalidate RBAC cache
    await this.invalidateRBACCache(dto.userId, dto.orgId);

    // Emit membership created event
    this.eventBus.emit({
      eventType: 'membership.created',
      timestamp: new Date(),
      organizationId: dto.orgId,
      userId: dto.userId,
      payload: {
        membershipId: membership.id,
        userId: dto.userId,
        orgId: dto.orgId,
        role: dto.role,
      },
    });

    return membership;
  }

  async findMembershipByUserAndOrg(userId: string, orgId: string): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: {
        userId_orgId: {
          userId,
          orgId,
        },
      },
    });
  }

  async getMembershipOrThrow(userId: string, orgId: string): Promise<Membership> {
    const membership = await this.findMembershipByUserAndOrg(userId, orgId);

    if (!membership) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    return membership;
  }

  async findMembershipsByOrg(orgId: string): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: { orgId },
      include: { user: true },
    });
  }

  async findMembershipsByUser(userId: string): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
    });
  }

  async updateMembership(id: string, dto: UpdateMembershipDto): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const updated = await this.prisma.membership.update({
      where: { id },
      data: { role: dto.role },
    });

    // Invalidate RBAC cache
    await this.invalidateRBACCache(membership.userId, membership.orgId);

    // Emit membership updated event
    this.eventBus.emit({
      eventType: 'membership.updated',
      timestamp: new Date(),
      organizationId: membership.orgId,
      userId: membership.userId,
      payload: {
        membershipId: id,
        oldRole: membership.role,
        newRole: dto.role,
      },
    });

    return updated;
  }

  async deleteMembership(id: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { id },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.membership.delete({
      where: { id },
    });

    // Invalidate RBAC cache
    await this.invalidateRBACCache(membership.userId, membership.orgId);

    // Emit membership deleted event
    this.eventBus.emit({
      eventType: 'membership.deleted',
      timestamp: new Date(),
      organizationId: membership.orgId,
      userId: membership.userId,
      payload: {
        membershipId: id,
        userId: membership.userId,
        orgId: membership.orgId,
        role: membership.role,
      },
    });

    this.logger.log(`Membership ${id} deleted`);
  }

  async hasRole(userId: string, orgId: string, roles: MembershipRole[]): Promise<boolean> {
    const membership = await this.findMembershipByUserAndOrg(userId, orgId);

    if (!membership) {
      return false;
    }

    return roles.includes(membership.role);
  }

  async isOwner(userId: string, orgId: string): Promise<boolean> {
    return this.hasRole(userId, orgId, [MembershipRole.OWNER]);
  }

  async isAdmin(userId: string, orgId: string): Promise<boolean> {
    return this.hasRole(userId, orgId, [MembershipRole.OWNER, MembershipRole.ADMIN]);
  }
}
