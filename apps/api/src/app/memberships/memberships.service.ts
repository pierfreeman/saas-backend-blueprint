import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '@libs/prisma';
import { AuditService, AUDIT_EVENTS } from '@libs/audit';
import { Membership, MembershipRole } from '@prisma/client';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { RBACCacheService } from '../rbac/services/rbac-cache.service';

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(forwardRef(() => RBACCacheService))
    private readonly rbacCache?: RBACCacheService,
  ) {}

  async createMembership(
    orgId: string,
    dto: CreateMembershipDto,
    actorUserId?: string,
  ): Promise<Membership> {
    this.logger.log(
      `Adding user ${dto.userId} to org ${orgId} with role ${dto.role}`,
    );

    const membership = await this.prisma.membership.create({
      data: { userId: dto.userId, orgId, role: dto.role },
    });

    await this.rbacCache?.invalidate(dto.userId, orgId);

    // ISO 27001 A.9.2 – log access provisioning
    this.audit.logEventBackground({
      type: AUDIT_EVENTS.MEMBERSHIP.CREATED,
      orgId,
      userId: actorUserId ?? null,
      payload: {
        membershipId: membership.id,
        targetUserId: dto.userId,
        role: dto.role,
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

    if (!membership || membership.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    const previousRole = membership.role;
    const updated = await this.prisma.membership.update({
      where: { id },
      data: { role: dto.role },
    });

    await this.rbacCache?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} updated to role ${dto.role}`);

    // ISO 27001 A.9.2 – log privilege change (elevated severity)
    this.audit.logEventBackground({
      type: AUDIT_EVENTS.MEMBERSHIP.ROLE_CHANGED,
      orgId,
      userId: actorUserId ?? null,
      severity: 'MEDIUM',
      payload: {
        membershipId: id,
        targetUserId: membership.userId,
        previousRole,
        newRole: dto.role,
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

    if (!membership || membership.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }

    await this.prisma.membership.delete({ where: { id } });
    await this.rbacCache?.invalidate(membership.userId, membership.orgId);
    this.logger.log(`Membership ${id} deleted`);

    // ISO 27001 A.9.2 – log access revocation
    this.audit.logEventBackground({
      type: AUDIT_EVENTS.MEMBERSHIP.DELETED,
      orgId,
      userId: actorUserId ?? null,
      payload: {
        membershipId: id,
        targetUserId: membership.userId,
        role: membership.role,
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
