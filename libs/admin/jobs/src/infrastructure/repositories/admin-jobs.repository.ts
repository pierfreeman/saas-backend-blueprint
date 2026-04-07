import { Injectable } from '@nestjs/common';
import { Job, Prisma, JobStatus } from '@libs/prisma-business';
import { PrismaBusinessService } from '@libs/prisma-business';
import type {
  AdminJobItem,
  ListJobsQuery,
  PaginatedAdminJobsResult,
} from '../../dto/admin-jobs.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminJobsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findByOrg(
    orgId: string,
    query: ListJobsQuery,
  ): Promise<PaginatedAdminJobsResult> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;

    const where: Prisma.JobWhereInput = {
      orgId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { items: rows.map(this.toItem), total, limit, offset };
  }

  private toItem(job: Job): AdminJobItem {
    return {
      id: job.id,
      orgId: job.orgId,
      userId: job.userId,
      type: job.type,
      status: job.status as JobStatus,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      result: job.result as Record<string, unknown> | null,
      error: job.error,
      attempts: job.attempts,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
