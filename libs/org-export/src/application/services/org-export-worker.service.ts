import { EventBusService } from '@libs/events';
import { LegalAuditService } from '@libs/legal-audit';
import { StorageService, S3StorageClient } from '@libs/storage';
import { EmailService } from '@libs/email';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportStatus } from '@libs/prisma-business';
import JSZip from 'jszip';
import { ORG_EXPORT_EVENT_TYPES } from '../../constants/org-export-event.constants';
import { OrgExportRepository } from '../../infrastructure/repositories/org-export.repository';

/**
 * Worker service responsible for executing organization data export.
 * Performs all export operations:
 * - Data aggregation from database
 * - JSON serialization and compression (zip)
 * - File upload to storage
 * - Signed URL generation
 *
 * This service is idempotent and safe to retry.
 */
@Injectable()
export class OrgExportWorkerService {
  private readonly logger = new Logger(OrgExportWorkerService.name);
  private readonly urlExpirationHours: number;

  constructor(
    private readonly repo: OrgExportRepository,
    private readonly eventBus: EventBusService,
    private readonly legalAudit: LegalAuditService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly s3Client: S3StorageClient,
  ) {
    this.urlExpirationHours = this.config.get<number>(
      'EXPORT_URL_EXPIRATION_HOURS',
      24,
    );
  }

  /**
   * Execute organization data export.
   * This is the main entry point called by the worker.
   *
   * @param orgId - Organization ID to export
   * @param exportId - Export record ID
   * @param jobId - Job ID tracking this export
   * @param orgName - Organization name (for logging/audit)
   * @param requestedByUserId - User who requested the export
   * @param requestedAt - When export was requested
   */
  async executeExport(
    orgId: string,
    exportId: string,
    jobId: string,
    orgName: string,
    requestedByUserId: string,
    requestedAt: Date,
  ): Promise<void> {
    this.logger.log(
      `Starting export ${exportId} for organization ${orgId} (${orgName})`,
    );

    const startedAt = new Date();

    // Emit export started event
    await this.eventBus.publish({
      eventType: ORG_EXPORT_EVENT_TYPES.EXPORT_STARTED,
      payload: {
        orgId,
        exportId,
        startedAt,
      } as unknown as Record<string, unknown>,
      tenantId: orgId,
      timestamp: new Date(),
    });

    try {
      // Check if export exists and is not already completed
      const exportRecord = await this.repo.findExportRecord(exportId);

      if (!exportRecord) {
        this.logger.warn(
          `Export ${exportId} not found — may have been deleted`,
        );
        return; // Idempotent: treat as success
      }

      if (exportRecord.status === ExportStatus.COMPLETED) {
        this.logger.warn(
          `Export ${exportId} already marked as COMPLETED — skipping`,
        );
        return; // Idempotent: already processed
      }

      // Update status to PROCESSING
      await this.repo.markExportProcessing(exportId, jobId);

      // Step 1: Aggregate organization data
      this.logger.log(`Aggregating data for organization ${orgId}`);
      const exportData = await this.aggregateOrgData(orgId);

      // Step 2: Generate export file (JSON + zip)
      this.logger.log(`Generating export file for organization ${orgId}`);
      const { buffer, size, filename } = await this.generateExportFile(
        exportData,
        orgId,
        orgName,
      );

      // Step 3: Upload file to storage
      this.logger.log(`Uploading export file for organization ${orgId}`);
      const storageKey = `exports/org/${orgId}/${filename}`;
      await this.uploadExportFile(storageKey, buffer);

      // Step 4: Generate signed download URL
      this.logger.log(
        `Generating download URL for organization ${orgId} export`,
      );
      const expiresAt = new Date(
        Date.now() + this.urlExpirationHours * 60 * 60 * 1000,
      );

      const expirationSeconds = this.urlExpirationHours * 60 * 60;
      const downloadUrl = await this.s3Client.generatePresignedDownloadUrl(
        storageKey,
        expirationSeconds,
      );

      const completedAt = new Date();

      // Step 5: Persist completion
      await this.repo.completeExport({
        exportId,
        jobId,
        downloadUrl,
        fileSize: size,
        expiresAt,
        completedAt,
      });

      this.logger.log(
        `Export ${exportId} for organization ${orgId} (${orgName}) completed successfully`,
      );

      // Send notification email to the requesting user
      await this.sendExportReadyEmail(
        requestedByUserId,
        orgName,
        downloadUrl,
        expiresAt,
        size,
        orgId,
      );

      // Emit export completed event
      await this.eventBus.publish({
        eventType: ORG_EXPORT_EVENT_TYPES.EXPORT_COMPLETED,
        payload: {
          orgId,
          exportId,
          orgName,
          requestedByUserId,
          requestedAt,
          completedAt,
          fileSize: size,
          fileUrl: downloadUrl,
          expiresAt,
        } as unknown as Record<string, unknown>,
        tenantId: orgId,
        timestamp: new Date(),
      });

      // Record legal audit event (permanent)
      this.legalAudit.recordEvent({
        eventType: 'organization.export.completed',
        orgId,
        triggerType: 'user',
        metadata: {
          organizationId: orgId,
          organizationName: orgName,
          exportId,
          requestedByUserId,
          requestedAt: new Date(requestedAt).toISOString(),
          completedAt: completedAt.toISOString(),
          fileSizeBytes: size,
          expiresAt: expiresAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to export data for organization ${orgId}: ${message}`,
        error,
      );

      // Update export status to FAILED
      await this.repo.failExport({ exportId, jobId, error: message });

      // Emit export failed event
      await this.eventBus.publish({
        eventType: ORG_EXPORT_EVENT_TYPES.EXPORT_FAILED,
        payload: {
          orgId,
          exportId,
          error: message,
          failedAt: new Date(),
        } as unknown as Record<string, unknown>,
        tenantId: orgId,
        timestamp: new Date(),
      });

      // Record failure in legal audit
      this.legalAudit.recordEvent({
        eventType: 'organization.export.failed',
        orgId,
        triggerType: 'user',
        metadata: {
          organizationId: orgId,
          organizationName: orgName,
          exportId,
          error: message,
          failedAt: new Date().toISOString(),
        },
      });

      throw error; // Re-throw so SQS can handle DLQ
    }
  }

  /**
   * Aggregate all organization data for export.
   * Queries all relevant tables filtering by orgId.
   */
  private async aggregateOrgData(
    orgId: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.repo.aggregateOrgData(orgId);

    return {
      organization: raw.organization
        ? this.sanitizeOrganization(raw.organization)
        : null,
      memberships: (raw.memberships as unknown[]).map((m) =>
        this.sanitizeMembership(m),
      ),
      activityLogs: (raw.activityLogs as unknown[]).map((a) =>
        this.sanitizeActivityLog(a),
      ),
      jobs: (raw.jobs as unknown[]).map((j) => this.sanitizeJob(j)),
      files: (raw.files as unknown[]).map((f) => this.sanitizeFile(f)),
      notifications: (raw.notifications as unknown[]).map((n) =>
        this.sanitizeNotification(n),
      ),
      metadata: {
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
    };
  }

  /**
   * Generate export file: serialize to JSON and compress as a zip archive.
   * Returns the buffer, byte size, and the filename to use for storage.
   */
  private async generateExportFile(
    data: Record<string, unknown>,
    orgId: string,
    orgName: string,
  ): Promise<{ buffer: Buffer; size: number; filename: string }> {
    const json = JSON.stringify(data, this.jsonReplacer, 2);

    const zip = new JSZip();
    zip.file('export.json', json);
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const size = buffer.length;

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeName = orgName
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    const filename = `${datePrefix}_${safeName}_Export.zip`;

    this.logger.log(
      `Export file generated for ${orgName}: ${size} bytes (compressed)`,
    );

    return { buffer, size, filename };
  }

  /**
   * Upload export file to storage.
   */
  private async uploadExportFile(
    storageKey: string,
    buffer: Buffer,
  ): Promise<void> {
    await this.s3Client.putObject(storageKey, buffer, 'application/zip');
    this.logger.log(`Uploaded export file to ${storageKey}`);
  }

  /**
   * Look up the requesting user's email and send an export-ready notification.
   * Failures are logged but do not abort the export workflow.
   */
  private async sendExportReadyEmail(
    userId: string,
    orgName: string,
    downloadUrl: string,
    expiresAt: Date,
    fileSizeBytes: number,
    orgId: string,
  ): Promise<void> {
    try {
      const user = await this.repo.findUserById(userId);

      if (!user) {
        this.logger.warn(
          `Cannot send export email — user not found for id: ${userId}`,
        );
        return;
      }

      const expirationDays = Math.ceil(
        (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      await this.email.sendTransactionalEmail({
        templateName: 'export-ready',
        recipient: user.email,
        subject: `Your ${orgName} data export is ready`,
        data: {
          userName: user.email.split('@')[0],
          exportType: 'Organisation Data',
          fileSize: `${(fileSizeBytes / 1024).toFixed(1)} KB`,
          downloadUrl,
          downloadExpirationDays: expirationDays,
          completedAt: new Date().toISOString(),
        },
        orgId,
        userId,
      });

      this.logger.log(`Export-ready email sent to ${user.email}`);
    } catch (err) {
      this.logger.error(
        `Failed to send export-ready email: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
      // Do not rethrow — email failure must not affect export status
    }
  }

  /**
   * JSON replacer to handle BigInt serialization.
   */
  private jsonReplacer(key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }

  // Sanitization methods to remove sensitive data and convert to plain objects

  private sanitizeOrganization(org: unknown): Record<string, unknown> {
    const o = org as {
      id: string;
      name: string;
      status: string;
      billingStatus: string | null;
      planId: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
    };
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      billingStatus: o.billingStatus,
      planId: o.planId,
      createdAt: o.createdAt?.toISOString(),
      updatedAt: o.updatedAt?.toISOString(),
    };
  }

  private sanitizeMembership(membership: unknown): Record<string, unknown> {
    const m = membership as {
      id: string;
      role: string;
      status: string;
      invitedAt: Date | null;
      joinedAt: Date | null;
      user: {
        id: string;
        email: string;
        auth0Id: string;
        createdAt: Date | null;
      } | null;
    };
    return {
      id: m.id,
      role: m.role,
      status: m.status,
      invitedAt: m.invitedAt?.toISOString(),
      joinedAt: m.joinedAt?.toISOString(),
      user: m.user
        ? {
            id: m.user.id,
            email: m.user.email,
            auth0Id: m.user.auth0Id,
            createdAt: m.user.createdAt?.toISOString(),
          }
        : null,
    };
  }

  private sanitizeActivityLog(log: unknown): Record<string, unknown> {
    const l = log as {
      id: string;
      action: string;
      entityType: string | null;
      entityId: string | null;
      actorRole: string | null;
      metadata: unknown;
      createdAt: Date | null;
    };
    return {
      id: l.id,
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      actorRole: l.actorRole,
      metadata: l.metadata,
      createdAt: l.createdAt?.toISOString(),
    };
  }

  private sanitizeJob(job: unknown): Record<string, unknown> {
    const j = job as {
      id: string;
      type: string;
      status: string;
      payload: unknown;
      result: unknown;
      error: string | null;
      attempts: number;
      createdAt: Date | null;
      startedAt: Date | null;
      finishedAt: Date | null;
    };
    return {
      id: j.id,
      type: j.type,
      status: j.status,
      payload: j.payload,
      result: j.result,
      error: j.error,
      attempts: j.attempts,
      createdAt: j.createdAt?.toISOString(),
      startedAt: j.startedAt?.toISOString(),
      finishedAt: j.finishedAt?.toISOString(),
    };
  }

  private sanitizeFile(file: unknown): Record<string, unknown> {
    const f = file as {
      id: string;
      filename: string;
      mimeType: string;
      size: bigint | null;
      status: string;
      storageKey: string;
      createdAt: Date | null;
      confirmedAt: Date | null;
    };
    return {
      id: f.id,
      filename: f.filename,
      mimeType: f.mimeType,
      size: f.size?.toString(),
      status: f.status,
      storageKey: f.storageKey,
      createdAt: f.createdAt?.toISOString(),
      confirmedAt: f.confirmedAt?.toISOString(),
    };
  }

  private sanitizeNotification(notification: unknown): Record<string, unknown> {
    const n = notification as {
      id: string;
      type: string;
      title: string;
      message: string;
      isRead: boolean;
      metadata: unknown;
      createdAt: Date | null;
      readAt: Date | null;
    };
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.isRead,
      metadata: n.metadata,
      createdAt: n.createdAt?.toISOString(),
      readAt: n.readAt?.toISOString(),
    };
  }
}
