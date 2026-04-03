import { Injectable } from '@nestjs/common';
import { ActivityLog, Prisma } from '@libs/prisma-business';
import { PrismaBusinessService } from '@libs/prisma-business';
import type { ActivityLogRecord } from '@libs/activity-log';
import type { GetAllActivityQuery } from '../../dto/admin-activity-log.dto';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Injectable()
export class AdminActivityLogRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Cross-org paginated activity log query.
   * When `orgId` is provided, scopes to that org; otherwise returns logs from
   * all organizations (for the global admin feed).
   */
  async findAll(query: GetAllActivityQuery): Promise<{
    items: ActivityLogRecord[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;

    const where: Prisma.ActivityLogWhereInput = {
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.action ? { action: { startsWith: query.action } } : {}),
      ...(query.fromDate || query.toDate
        ? { createdAt: { gte: query.fromDate, lte: query.toDate } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { items: rows.map(this.toRecord), total, limit, offset };
  }

  private toRecord(log: ActivityLog): ActivityLogRecord {
    return {
      id: log.id,
      orgId: log.orgId,
      actorId: log.actorId,
      actorRole: log.actorRole,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      metadata: log.metadata as Record<string, unknown>,
      createdAt: log.createdAt,
    };
  }
}
