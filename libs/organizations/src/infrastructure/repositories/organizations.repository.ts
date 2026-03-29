import { Injectable } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, Organization } from '@libs/prisma-business';

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async createWithOwner(name: string, userId: string): Promise<Organization> {
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name } });
      await tx.membership.create({
        data: { userId, orgId: org.id, role: MembershipRole.OWNER },
      });
      return org;
    });
  }

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
    });
    return memberships.map((m) => m.organization);
  }

  async update(id: string, data: { name?: string }): Promise<Organization> {
    return this.prisma.organization.update({ where: { id }, data });
  }

  async deleteJobs(orgId: string): Promise<void> {
    await this.prisma.job.deleteMany({ where: { orgId } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.organization.delete({ where: { id } });
  }
}
