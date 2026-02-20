import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Organization, Subscription, OrganizationStatus } from '@prisma/client';

export interface OrganizationWithStats extends Organization {
  _count: {
    teams: number;
    players: number;
    memberships: number;
  };
  subscription: Subscription | null;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listOrganizations(
    limit = 50,
    offset = 0,
    status?: OrganizationStatus,
  ): Promise<{
    organizations: OrganizationWithStats[];
    total: number;
  }> {
    const where = status ? { status } : {};

    const [organizations, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: {
          _count: {
            select: {
              teams: true,
              players: true,
              memberships: true,
            },
          },
          subscription: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.organization.count({ where }),
    ]);

    this.logger.log(`Listed ${organizations.length} organizations (total: ${total})`);

    return { organizations, total };
  }

  async getOrganizationById(id: string): Promise<OrganizationWithStats> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            teams: true,
            players: true,
            memberships: true,
          },
        },
        subscription: true,
      },
    });

    if (!organization) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return organization;
  }

  async suspendOrganization(id: string, reason?: string): Promise<Organization> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: OrganizationStatus.SUSPENDED },
    });

    this.logger.warn(`Organization ${id} suspended${reason ? `: ${reason}` : ''}`);

    return updated;
  }

  async reactivateOrganization(id: string): Promise<Organization> {
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    const updated = await this.prisma.organization.update({
      where: { id },
      data: { status: OrganizationStatus.ACTIVE },
    });

    this.logger.log(`Organization ${id} reactivated`);

    return updated;
  }

  async listSubscriptions(
    limit = 50,
    offset = 0,
  ): Promise<{
    subscriptions: (Subscription & { organization: Organization })[];
    total: number;
  }> {
    const [subscriptions, total] = await Promise.all([
      this.prisma.subscription.findMany({
        include: {
          organization: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.subscription.count(),
    ]);

    this.logger.log(`Listed ${subscriptions.length} subscriptions (total: ${total})`);

    return { subscriptions, total };
  }

  async getSystemStats(): Promise<{
    totalOrganizations: number;
    activeOrganizations: number;
    suspendedOrganizations: number;
    totalUsers: number;
    totalTeams: number;
    totalPlayers: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
  }> {
    const [
      totalOrganizations,
      activeOrganizations,
      suspendedOrganizations,
      totalUsers,
      totalTeams,
      totalPlayers,
      totalSubscriptions,
      activeSubscriptions,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({
        where: { status: OrganizationStatus.ACTIVE },
      }),
      this.prisma.organization.count({
        where: { status: OrganizationStatus.SUSPENDED },
      }),
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.player.count(),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({
        where: { status: 'ACTIVE' },
      }),
    ]);

    return {
      totalOrganizations,
      activeOrganizations,
      suspendedOrganizations,
      totalUsers,
      totalTeams,
      totalPlayers,
      totalSubscriptions,
      activeSubscriptions,
    };
  }
}
