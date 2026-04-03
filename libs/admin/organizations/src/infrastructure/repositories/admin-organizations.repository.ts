import { Injectable } from '@nestjs/common';
import {
  Organization,
  OrganizationStatus,
  Prisma,
} from '@libs/prisma-business';
import { PrismaBusinessService } from '@libs/prisma-business';

type OrgWithMemberCount = Organization & { _count: { memberships: number } };

@Injectable()
export class AdminOrganizationsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findAll(
    filters: { search?: string; status?: OrganizationStatus },
    pagination: { limit: number; offset: number },
  ): Promise<{ items: OrgWithMemberCount[]; total: number }> {
    const where = this.buildWhereClause(filters);

    const [items, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { items, total };
  }

  async findByIdWithMemberCount(
    id: string,
  ): Promise<OrgWithMemberCount | null> {
    return this.prisma.organization.findUnique({
      where: { id },
      include: { _count: { select: { memberships: true } } },
    });
  }

  async createOrg(name: string): Promise<Organization> {
    return this.prisma.organization.create({ data: { name } });
  }

  async updatePlanId(orgId: string, planId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { planId },
    });
  }

  async updateStatus(
    orgId: string,
    status: OrganizationStatus,
  ): Promise<OrgWithMemberCount> {
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { status },
      include: { _count: { select: { memberships: true } } },
    });
  }

  private buildWhereClause(filters: {
    search?: string;
    status?: OrganizationStatus;
  }): Prisma.OrganizationWhereInput {
    const where: Prisma.OrganizationWhereInput = {};

    if (filters.search) {
      const trimmed = filters.search.trim();
      where.OR = [
        { name: { contains: trimmed, mode: 'insensitive' } },
        { id: trimmed },
      ];
    }

    if (filters.status) {
      where.status = filters.status;
    }

    return where;
  }
}
