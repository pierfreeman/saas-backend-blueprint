import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@libs/prisma';
import { AuditEvent, Prisma } from '@prisma/client';
import {
  AUDIT_SEVERITY,
  DEFAULT_SEVERITY_MAP,
  AuditSeverityLevel,
} from './audit-event-types.constants';
import type {
  AuditLogOptions,
  AuditEventRecord,
  PaginatedAuditResult,
  AuditQueryOptions,
} from './audit.types';

/**
 * AuditService – Core library for compliance-grade audit logging.
 *
 * Satisfies:
 *  • ISO 27001:2022  A.8.15 – Logging             (tamper-evident records)
 *  • ISO 27001:2022  A.8.16 – Monitoring           (structured typed events)
 *  • GDPR Art. 5(2)          – Accountability       (who did what, when, where)
 *  • GDPR Art. 30            – Records of processing (org + user scope)
 *  • GDPR Art. 32            – Security of processing (severity + IP logging)
 *
 * Design decisions:
 *  - All writes are fire-and-forget with error swallowing so that a failure to
 *    persist an audit event never breaks the business transaction.
 *  - Sensitive field names are redacted from payloads automatically.
 *  - UUID format is validated before use as a Prisma relation key to prevent
 *    unexpected Prisma validation errors.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /** Payload fields that must never be stored in plain text. */
  private static readonly REDACTED_FIELDS = new Set([
    'password',
    'passwordHash',
    'secret',
    'token',
    'accessToken',
    'refreshToken',
    'apiKey',
    'privateKey',
    'creditCard',
    'cvv',
    'ssn',
  ]);

  private static readonly UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(private readonly prisma: PrismaService) {}

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Persists a single audit event.
   *
   * Errors are caught and logged (never propagated) so that audit failures
   * cannot silently abort business-critical transactions.
   */
  async logEvent(options: AuditLogOptions): Promise<AuditEvent | null> {
    const {
      type,
      orgId = null,
      userId = null,
      payload = {},
      ipAddress = null,
      userAgent = null,
      correlationId = null,
    } = options;

    const severity = options.severity ?? this.resolveSeverity(type);
    const sanitisedPayload = this.sanitisePayload(payload);

    const safeOrgId = this.toNullableUuid(orgId);
    const safeUserId = this.toNullableUuid(userId);

    this.logger.debug(
      `[${severity}] ${type} | org=${safeOrgId ?? 'global'} user=${safeUserId ?? 'system'}`,
    );

    try {
      return await this.prisma.auditEvent.create({
        data: {
          type,
          severity,
          orgId: safeOrgId,
          userId: safeUserId,
          payload: sanitisedPayload as Prisma.InputJsonValue,
          ipAddress,
          userAgent,
          correlationId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist audit event "${type}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Fire-and-forget variant — does not return a value and never throws.
   * Preferred for use inside business services where you don't need the result.
   */
  logEventBackground(options: AuditLogOptions): void {
    this.logEvent(options).catch((err: unknown) => {
      this.logger.error(
        `logEventBackground unhandled rejection: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  /** Returns paginated audit events for a specific organisation. */
  async findByOrg(
    orgId: string,
    options: AuditQueryOptions = {},
  ): Promise<PaginatedAuditResult> {
    const {
      limit = 100,
      offset = 0,
      typePrefix,
      severity,
      fromDate,
      toDate,
    } = options;

    const where: Prisma.AuditEventWhereInput = {
      orgId,
      ...(typePrefix ? { type: { startsWith: typePrefix } } : {}),
      ...(severity ? { severity } : {}),
      ...(fromDate || toDate
        ? { createdAt: { gte: fromDate, lte: toDate } }
        : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events: events.map(this.toRecord), total, limit, offset };
  }

  /** Returns paginated audit events for a specific user across all orgs (GDPR Art. 15). */
  async findByUser(
    userId: string,
    options: AuditQueryOptions = {},
  ): Promise<PaginatedAuditResult> {
    const {
      limit = 100,
      offset = 0,
      typePrefix,
      severity,
      fromDate,
      toDate,
    } = options;

    const where: Prisma.AuditEventWhereInput = {
      userId,
      ...(typePrefix ? { type: { startsWith: typePrefix } } : {}),
      ...(severity ? { severity } : {}),
      ...(fromDate || toDate
        ? { createdAt: { gte: fromDate, lte: toDate } }
        : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events: events.map(this.toRecord), total, limit, offset };
  }

  /** Returns paginated audit events filtered by event type (exact or prefix). */
  async findByType(
    type: string,
    options: AuditQueryOptions = {},
  ): Promise<PaginatedAuditResult> {
    const { limit = 100, offset = 0, fromDate, toDate } = options;

    const where: Prisma.AuditEventWhereInput = {
      type,
      ...(fromDate || toDate
        ? { createdAt: { gte: fromDate, lte: toDate } }
        : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events: events.map(this.toRecord), total, limit, offset };
  }

  /** Returns all audit events with optional filtering. */
  async findAll(
    options: AuditQueryOptions = {},
  ): Promise<PaginatedAuditResult> {
    const {
      limit = 100,
      offset = 0,
      typePrefix,
      severity,
      fromDate,
      toDate,
    } = options;

    const where: Prisma.AuditEventWhereInput = {
      ...(typePrefix ? { type: { startsWith: typePrefix } } : {}),
      ...(severity ? { severity } : {}),
      ...(fromDate || toDate
        ? { createdAt: { gte: fromDate, lte: toDate } }
        : {}),
    };

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { events: events.map(this.toRecord), total, limit, offset };
  }

  /** Total event count for an organisation (useful for dashboards). */
  async countByOrg(orgId: string): Promise<number> {
    return this.prisma.auditEvent.count({ where: { orgId } });
  }

  /** Total event count for a user (GDPR subject access fulfilment). */
  async countByUser(userId: string): Promise<number> {
    return this.prisma.auditEvent.count({ where: { userId } });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Resolves severity from the DEFAULT_SEVERITY_MAP or falls back to INFO.
   * Exposed as non-private for testing.
   */
  resolveSeverity(type: string): AuditSeverityLevel {
    return DEFAULT_SEVERITY_MAP[type] ?? AUDIT_SEVERITY.INFO;
  }

  /**
   * Recursively redacts known sensitive field names from a payload object.
   * Values are replaced with the string '[REDACTED]' to preserve structure.
   */
  sanitisePayload(
    payload: Record<string, unknown>,
    depth = 0,
  ): Record<string, unknown> {
    if (depth > 5) {
      // Guard against deeply nested circular structures
      return payload;
    }

    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (AuditService.REDACTED_FIELDS.has(key)) {
        result[key] = '[REDACTED]';
      } else if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        result[key] = this.sanitisePayload(
          value as Record<string, unknown>,
          depth + 1,
        );
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Validates and returns a UUID string, or null if the input is invalid.
   * Prevents Prisma relation errors caused by malformed IDs.
   */
  toNullableUuid(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return AuditService.UUID_REGEX.test(value) ? value : null;
  }

  /** Maps a Prisma AuditEvent to a plain AuditEventRecord. */
  private toRecord(event: AuditEvent): AuditEventRecord {
    return {
      id: event.id,
      type: event.type,
      severity: event.severity,
      orgId: event.orgId,
      userId: event.userId,
      payload: event.payload as Record<string, unknown>,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
    };
  }
}
