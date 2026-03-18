import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { ActivityLogService } from '@libs/activity-log';
import { ORG_EXPORT_EVENT_TYPES } from './constants/org-export-event.constants';
import { OrgExportRequestedEventPayload } from './interfaces/org-export-event.interface';
import { OrgExportRepository } from './infrastructure/repositories/org-export.repository';

/**
 * Service responsible for orchestrating organization data export requests.
 * Handles export creation, job creation, and event emission.
 *
 * This service does NOT perform the actual data aggregation - that is handled
 * by the export worker in response to export events.
 */
@Injectable()
export class OrgExportService {
  private readonly logger = new Logger(OrgExportService.name);

  constructor(
    private readonly repo: OrgExportRepository,
    private readonly eventBus: EventBusService,
    private readonly legalAudit: LegalAuditService,
    private readonly activityLog: ActivityLogService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Request a data export for an organization.
   * Creates OrgExport record, Job record, and emits event for worker processing.
   *
   * @param orgId - Organization ID to export
   * @param userId - User ID who requested export
   * @returns Export ID
   * @throws NotFoundException if organization not found
   */
  async requestExport(orgId: string, userId: string): Promise<string> {
    this.logger.log(
      `Export requested for organization ${orgId} by user ${userId}`,
    );

    // Load organization to verify it exists
    const org = await this.repo.findOrgById(orgId);

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found`);
    }

    // Check if organization is in valid state for export
    if (org.status === 'DELETED') {
      throw new BadRequestException(
        `Organization ${orgId} has been deleted and cannot be exported`,
      );
    }

    const now = new Date();

    const { exportId, jobId } = await this.repo.createJobAndExport({
      orgId,
      userId,
      exportEventType: ORG_EXPORT_EVENT_TYPES.EXPORT_REQUESTED,
    });

    this.logger.log(
      `Export ${exportId} created with job ${jobId} for organization ${orgId}`,
    );

    // Log to activity log (will be cascade-deleted with org)
    this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'organization.export.requested',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        exportId,
        jobId,
        requestedAt: now.toISOString(),
      },
    });

    // Record legal audit event (permanent, survives deletion)
    this.legalAudit.recordEvent({
      eventType: ORG_EXPORT_EVENT_TYPES.EXPORT_REQUESTED,
      orgId,
      userId,
      triggerType: 'user_action',
      metadata: {
        organizationId: orgId,
        organizationName: org.name,
        exportId,
        jobId,
        requestedAt: now.toISOString(),
      },
    });

    // Emit event to trigger background export worker
    const eventPayload: OrgExportRequestedEventPayload = {
      orgId,
      exportId,
      jobId,
      requestedByUserId: userId,
      orgName: org.name,
      requestedAt: now,
    } as OrgExportRequestedEventPayload;

    await this.eventBus.publish({
      eventType: ORG_EXPORT_EVENT_TYPES.EXPORT_REQUESTED,
      payload: eventPayload as Record<string, unknown>,
      tenantId: orgId,
      userId,
      timestamp: new Date(),
    });

    this.logger.log(`Export event emitted for organization ${orgId}`);

    return exportId;
  }

  /**
   * Get export status by ID.
   *
   * @param exportId - Export ID
   * @param orgId - Organization ID (for tenant isolation)
   * @returns Export record
   * @throws NotFoundException if export not found or belongs to different org
   */
  async getExport(exportId: string, orgId: string) {
    const exportRecord = await this.repo.findExportByIdAndOrg(exportId, orgId);

    if (!exportRecord) {
      throw new NotFoundException(
        `Export ${exportId} not found for organization ${orgId}`,
      );
    }

    return exportRecord;
  }

  /**
   * List all exports for an organization.
   *
   * @param orgId - Organization ID
   * @param limit - Maximum number of results (default: 10)
   * @param offset - Number of results to skip (default: 0)
   * @returns List of export records
   */
  async listExports(orgId: string, limit = 10, offset = 0) {
    return this.repo.findExportsByOrg(orgId, limit, offset);
  }
}
