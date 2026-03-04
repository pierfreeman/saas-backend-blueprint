import { Injectable, Logger } from '@nestjs/common';
import { ActivityLog, Prisma } from '@prisma/client';
import { PrismaBusinessService } from '@libs/prisma-business';
import type {
  ActivityLogEvent,
  ActivityLogRecord,
  ActivityLogQueryOptions,
  PaginatedActivityLogResult,
} from './activity-log.types';

/**
 * ActivityLogService – Business-level activity logging.
 *
 * Records tenant-visible operational events in the `app_audit.activity_logs`
 * table of the business PostgreSQL database. Scoped exclusively to an
 * organisation — every log entry requires an orgId.
 *
 * Design decisions:
 *  - All writes are fire-and-forget: failures are logged, never propagated.
 *  - Logs are cascade-deleted when the owning organisation is deleted.
 *  - Does NOT store IP addresses, user agents, or correlation IDs — those
 *    belong in the legal audit database (see @libs/legal-audit).
 *  - Has no knowledge of HTTP, request contexts, or transport concerns.
 *  - Does NOT depend on LegalAuditModule and must never import from it.
 */
@Injectable()
export class ActivityLogService {
  readonly logger = new Logger(ActivityLogService.name);

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(private readonly prisma: PrismaBusinessService) {}

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget activity log write.
   * Does not return a value and never throws — failures are swallowed
   * and logged internally to ensure audit failures cannot break the
   * business operation that triggered them.
   */
  logActivity(event: ActivityLogEvent): void {
    this.persist(event).catch((err: unknown) => {
      this.logger.error(
        `logActivity unhandled rejection for "${event.action}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private async persist(event: ActivityLogEvent): Promise<void> {
    const safeOrgId = this.toNullableUuid(event.orgId);
    if (!safeOrgId) {
      this.logger.warn(
        `logActivity skipped: invalid orgId "${event.orgId}" for action "${event.action}"`,
      );
      return;
    }

    const safeActorId = this.toNullableUuid(event.actorId);
    const safeEntityId = this.toNullableUuid(event.entityId);

    try {
      await this.prisma.activityLog.create({
        data: {
          orgId: safeOrgId,
          actorId: safeActorId,
          actorRole: event.actorRole ?? null,
          action: event.action,
          entityType: event.entityType ?? null,
          entityId: safeEntityId,
          metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist activity log for action "${event.action}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  /**
   * Returns paginated activity logs for a specific organisation.
   * Accessible to ADMIN and OWNER roles via the API.
   */
  async findByOrg(
    orgId: string,
    options: ActivityLogQueryOptions = {},
  ): Promise<PaginatedActivityLogResult> {
    const {
      limit = 100,
      offset = 0,
      action,
      fromDate,
      toDate,
    } = options;

    const where: Prisma.ActivityLogWhereInput = {
      orgId,
      ...(action ? { action: { startsWith: action } } : {}),
      ...(fromDate || toDate
        ? { createdAt: { gte: fromDate, lte: toDate } }
        : {}),
    };

    const [logs, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { logs: logs.map(this.toRecord), total, limit, offset };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Validates and returns a UUID string, or null if the input is invalid/missing.
   * Prevents Prisma relation errors caused by malformed IDs.
   */
  toNullableUuid(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return ActivityLogService.UUID_REGEX.test(value) ? value : null;
  }

  /** Maps a Prisma ActivityLog record to a plain ActivityLogRecord. */
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
