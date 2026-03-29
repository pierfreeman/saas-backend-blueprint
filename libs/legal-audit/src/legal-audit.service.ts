import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@libs/prisma-legal';
import { PrismaLegalService } from '@libs/prisma-legal';
import type { LegalAuditEvent } from './legal-audit.types';

/**
 * LegalAuditService – Immutable compliance event recorder.
 *
 * Writes append-only records to the legal audit PostgreSQL database
 * (a separate instance from the business database).
 *
 * Compliance guarantees:
 *  • ISO 27001:2022  A.8.15 – Logging             (tamper-evident records)
 *  • ISO 27001:2022  A.8.16 – Monitoring           (structured typed events)
 *  • GDPR Art. 5(2)          – Accountability       (who did what, when)
 *  • GDPR Art. 30            – Records of processing
 *
 * Design constraints:
 *  - Strictly append-only. No update or delete operations.
 *  - Records persist after organisation deletion (no FK, no cascade).
 *  - All writes are fire-and-forget: failures are swallowed internally
 *    so that compliance logging can NEVER abort a business transaction.
 *  - NOT queryable via public API — this is a write-only surface.
 *  - Does NOT store raw PII. Callers must sanitise before calling.
 *  - Does NOT depend on ActivityLogModule — the two systems are independent.
 */
@Injectable()
export class LegalAuditService {
  private readonly logger = new Logger(LegalAuditService.name);

  constructor(private readonly prismaLegal: PrismaLegalService) {}

  // ── Write ───────────────────────────────────────────────────────────────────

  /**
   * Fire-and-forget compliance event recorder.
   * Never throws. Failures are logged internally and silently discarded
   * to ensure legal audit failures cannot disrupt the business operation.
   */
  recordEvent(event: LegalAuditEvent): void {
    this.persist(event).catch((err: unknown) => {
      this.logger.error(
        `LegalAuditService unhandled rejection for "${event.eventType}": ${
          err instanceof Error ? err.message : JSON.stringify(err)
        }`,
      );
    });
  }

  private async persist(event: LegalAuditEvent): Promise<void> {
    try {
      await this.prismaLegal.auditEvent.create({
        data: {
          eventType: event.eventType,
          orgId: event.orgId ?? null,
          userId: event.userId ?? null,
          actorRole: event.actorRole ?? null,
          triggerType: event.triggerType ?? null,
          metadata: (event.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist legal audit event "${event.eventType}": ${
          error instanceof Error ? error.message : JSON.stringify(error)
        }`,
      );
    }
  }

  // ── No query methods ─────────────────────────────────────────────────────────
  // Legal audit records are NOT accessible via the public API.
  // Direct DB access by authorised personnel only (SIEM, compliance tooling).
}
