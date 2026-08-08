import {
  MembershipRole,
  Organization,
  PrismaBusinessService,
} from '@libs/prisma-business';
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Bypasses PrismaBusinessService's per-delegate RLS proxy on purpose: it
   * needs one transaction spanning both the `organizations` and
   * `memberships` INSERTs, and no tenant context can exist yet for an org
   * that doesn't exist yet. The id is generated client-side (instead of
   * relying on the DB) so `app.current_org_id` can be set to it *before*
   * either INSERT runs — required for the `WITH CHECK` clause on both
   * tables' RLS policies to pass.
   */
  async createWithOwner(name: string, userId: string): Promise<Organization> {
    const orgId = uuidv4();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      const org = await tx.organization.create({ data: { id: orgId, name } });
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
