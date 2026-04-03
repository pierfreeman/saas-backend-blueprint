import { Injectable } from '@nestjs/common';
import {
  Membership,
  MembershipStatus,
  Prisma,
  User,
} from '@libs/prisma-business';
import { PrismaBusinessService } from '@libs/prisma-business';

type MembershipWithUser = Membership & { user: User };

@Injectable()
export class AdminMembershipsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findByOrgPaginated(
    orgId: string,
    pagination: { limit: number; offset: number },
    filters: { status?: MembershipStatus } = {},
  ): Promise<{ items: MembershipWithUser[]; total: number }> {
    const where: Prisma.MembershipWhereInput = {
      orgId,
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        take: pagination.limit,
        skip: pagination.offset,
      }) as Promise<MembershipWithUser[]>,
      this.prisma.membership.count({ where }),
    ]);

    return { items, total };
  }
}
