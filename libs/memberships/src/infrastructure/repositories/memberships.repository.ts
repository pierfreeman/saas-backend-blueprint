import {
  Membership,
  MembershipRole,
  MembershipStatus,
  Organization,
  PrismaBusinessService,
  User,
} from '@libs/prisma-business';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MembershipsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async countActive(orgId: string): Promise<number> {
    return this.prisma.membership.count({
      where: {
        orgId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
      },
    });
  }

  async create(data: {
    userId: string;
    orgId: string;
    role: MembershipRole;
    status?: MembershipStatus;
  }): Promise<Membership> {
    return this.prisma.membership.create({ data });
  }

  async activateByUserId(userId: string): Promise<void> {
    await this.prisma.membership.updateMany({
      where: { userId, status: MembershipStatus.INVITED },
      data: { status: MembershipStatus.ACTIVE },
    });
  }

  async findByOrg(orgId: string): Promise<(Membership & { user: User })[]> {
    return this.prisma.membership.findMany({
      where: { orgId },
      include: { user: true },
    }) as Promise<(Membership & { user: User })[]>;
  }

  async findByUser(
    userId: string,
  ): Promise<(Membership & { organization: Organization })[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
    }) as Promise<(Membership & { organization: Organization })[]>;
  }

  async findById(id: string): Promise<Membership | null> {
    return this.prisma.membership.findUnique({ where: { id } });
  }

  async findByUserAndOrg(
    userId: string,
    orgId: string,
  ): Promise<Membership | null> {
    return this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
  }

  async update(
    id: string,
    data: { role?: MembershipRole; status?: MembershipStatus },
  ): Promise<Membership> {
    return this.prisma.membership.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.membership.delete({ where: { id } });
  }
}
