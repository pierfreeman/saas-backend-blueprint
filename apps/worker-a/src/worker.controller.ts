import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { PubSubService } from '@libs/redis';
import { DomainEvent, JobUpdateMessage } from '@libs/events';
import { JobStatus, Prisma } from '@prisma/client';
import { ActivityLogService } from '@libs/activity-log';

/**
 * Job payload carried inside DomainEvent.payload for HEAVY_JOB_CREATED events.
 * Extends Record<string, unknown> to satisfy the DomainEvent<T> generic constraint.
 */
export interface HeavyJobPayload extends Record<string, unknown> {
  jobId: string;
  tenantId: string;
  /** Auth0 subject of the user who submitted the job. Optional for system jobs. */
  userId?: string;
  data: Record<string, unknown>;
}

/**
 * Job payload for DATA_EXPORT_REQUESTED events.
 */
export interface DataExportPayload extends Record<string, unknown> {
  jobId: string;
  orgId: string;
  format: 'json' | 'csv';
}

/** Redis channel pattern: `job:update:{tenantId}` */
const jobChannel = (tenantId: string) => `job:update:${tenantId}`;

/**
 * WorkerController
 * Processes heavy computation jobs delivered via SQS.
 * Called by SqsConsumerService after deserialising the DomainEvent.
 *
 * State machine: PENDING → PROCESSING → DONE | FAILED
 *
 * Each transition:
 *   1. Updates the `jobs` table in Postgres (source of truth).
 *   2. Publishes a JobUpdateMessage to Redis Pub/Sub so that
 *      the API's JobsGateway can push the update to connected clients.
 */
@Injectable()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly pubSub: PubSubService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Handles a HEAVY_JOB_CREATED domain event.
   * Re-throws on failure so SqsConsumerService can handle DLQ logic.
   */
  async handleHeavyJobCreated(
    event: DomainEvent<HeavyJobPayload>,
  ): Promise<void> {
    const { jobId, tenantId, userId } = event.payload;

    this.logger.log(
      `[Worker-Compute-A] Received job: ${jobId} | tenant: ${tenantId}`,
    );

    // ── PENDING → PROCESSING ─────────────────────────────────────────────
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });

    await this.pubSub.publish(jobChannel(tenantId), {
      jobId,
      status: JobStatus.PROCESSING,
      tenantId,
      userId,
      updatedAt: new Date().toISOString(),
    } satisfies JobUpdateMessage);

    this.logger.log(`[Worker-Compute-A] Processing job ${jobId}...`);

    try {
      const result = await this.doWork(event.payload);

      // ── PROCESSING → DONE ─────────────────────────────────────────────
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.DONE,
          result: result as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });

      await this.pubSub.publish(jobChannel(tenantId), {
        jobId,
        status: JobStatus.DONE,
        tenantId,
        userId,
        result,
        updatedAt: new Date().toISOString(),
      } satisfies JobUpdateMessage);

      this.logger.log(`[Worker-Compute-A] Job ${jobId} completed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // ── PROCESSING → FAILED ───────────────────────────────────────────
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error: message,
          finishedAt: new Date(),
        },
      });

      await this.pubSub.publish(jobChannel(tenantId), {
        jobId,
        status: JobStatus.FAILED,
        tenantId,
        userId,
        error: message,
        updatedAt: new Date().toISOString(),
      } satisfies JobUpdateMessage);

      this.logger.error(`[Worker-Compute-A] Job ${jobId} failed: ${message}`);

      throw error; // re-throw → SqsConsumerService handles DLQ
    }
  }

  /**
   * Executes the actual computation for a job.
   * Replace this stub with real business logic.
   *
   * @returns structured result stored in `jobs.result`.
   */
  protected async doWork(
    payload: HeavyJobPayload,
  ): Promise<Record<string, unknown>> {
    // TODO: Replace with real computation logic.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.random() * 2000),
    );
    return {
      processed: true,
      jobId: payload.jobId,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Handles a DATA_EXPORT_REQUESTED domain event.
   * Generates a comprehensive export of organization data for GDPR/ISO27001 compliance.
   * Re-throws on failure so SqsConsumerService can handle DLQ logic.
   */
  async handleDataExportRequested(
    event: DomainEvent<DataExportPayload>,
  ): Promise<void> {
    const { jobId, orgId, format } = event.payload;

    this.logger.log(
      `[Worker-Compute-A] Received data export request: ${jobId} | orgId: ${orgId} | format: ${format}`,
    );

    // ── PENDING → PROCESSING ─────────────────────────────────────────────
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });

    await this.pubSub.publish(jobChannel(orgId), {
      jobId,
      status: JobStatus.PROCESSING,
      tenantId: orgId,
      updatedAt: new Date().toISOString(),
    } satisfies JobUpdateMessage);

    this.logger.log(`[Worker-Compute-A] Processing data export ${jobId}...`);

    try {
      const exportData = await this.generateOrgExport(orgId, format);

      // In production, upload to S3 and generate pre-signed URL
      // For now, we'll return the data inline for smaller orgs
      const result = {
        format,
        exportedAt: new Date().toISOString(),
        // In production: downloadUrl with S3 pre-signed URL
        // downloadUrl: 'https://s3.amazonaws.com/exports/...',
        data: exportData,
      };

      // ── PROCESSING → DONE ─────────────────────────────────────────────
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.DONE,
          result: result as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });

      await this.pubSub.publish(jobChannel(orgId), {
        jobId,
        status: JobStatus.DONE,
        tenantId: orgId,
        result,
        updatedAt: new Date().toISOString(),
      } satisfies JobUpdateMessage);

      // Log completion in activity log
      await this.activityLog.logActivity({
        orgId,
        actorId: null, // System action
        action: 'data_export.completed',
        entityType: 'organization',
        entityId: orgId,
        metadata: {
          jobId,
          format,
          recordCount: exportData.summary.totalRecords,
        },
      });

      this.logger.log(
        `[Worker-Compute-A] Data export ${jobId} completed successfully`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // ── PROCESSING → FAILED ───────────────────────────────────────────
      await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error: message,
          finishedAt: new Date(),
        },
      });

      await this.pubSub.publish(jobChannel(orgId), {
        jobId,
        status: JobStatus.FAILED,
        tenantId: orgId,
        error: message,
        updatedAt: new Date().toISOString(),
      } satisfies JobUpdateMessage);

      // Log failure in activity log
      await this.activityLog.logActivity({
        orgId,
        actorId: null,
        action: 'data_export.failed',
        entityType: 'organization',
        entityId: orgId,
        metadata: {
          jobId,
          error: message,
        },
      });

      this.logger.error(
        `[Worker-Compute-A] Data export ${jobId} failed: ${message}`,
      );

      throw error; // re-throw → SqsConsumerService handles DLQ
    }
  }

  /**
   * Generates a complete export of organization data.
   * Includes: organization details, memberships, activity logs, billing history.
   *
   * @param orgId - Organization UUID
   * @param format - Export format (json or csv)
   * @returns Exported data structure
   */
  private async generateOrgExport(
    orgId: string,
    format: 'json' | 'csv',
  ): Promise<Record<string, unknown>> {
    this.logger.log(
      `Generating org export for ${orgId} in ${format} format...`,
    );

    // Fetch organization data
    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!organization) {
      throw new Error(`Organization ${orgId} not found`);
    }

    // Fetch memberships with user details
    const memberships = await this.prisma.membership.findMany({
      where: { orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            createdAt: true,
          },
        },
      },
    });

    // Fetch activity logs
    const activityLogs = await this.prisma.activityLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 1000, // Limit to recent 1000 entries
    });

    // Fetch billing snapshots
    const billingSnapshots = await this.prisma.subscriptionSnapshot.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });

    // Compile export data
    const exportData = {
      exportMetadata: {
        exportedAt: new Date().toISOString(),
        format,
        version: '1.0',
      },
      organization: {
        id: organization.id,
        name: organization.name,
        status: organization.status,
        billingStatus: organization.billingStatus,
        planId: organization.planId,
        seatCount: organization.seatCount,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      },
      memberships: memberships.map((m) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        user: {
          id: m.user.id,
          email: m.user.email,
          joinedAt: m.user.createdAt,
        },
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      activityLogs: activityLogs.map((log) => ({
        id: log.id,
        action: log.action,
        actorId: log.actorId,
        actorRole: log.actorRole,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        createdAt: log.createdAt,
      })),
      billingHistory: billingSnapshots.map((snapshot) => ({
        id: snapshot.id,
        planId: snapshot.planId,
        status: snapshot.status,
        seats: snapshot.seats,
        periodStart: snapshot.periodStart,
        periodEnd: snapshot.periodEnd,
        createdAt: snapshot.createdAt,
      })),
      summary: {
        totalRecords:
          1 +
          memberships.length +
          activityLogs.length +
          billingSnapshots.length,
        membershipCount: memberships.length,
        activityLogCount: activityLogs.length,
        billingSnapshotCount: billingSnapshots.length,
      },
    };

    // For CSV format, we would flatten the data structure
    // For now, we return JSON structure for both formats
    // TODO: Implement CSV serialization for production
    if (format === 'csv') {
      this.logger.warn(
        'CSV format requested but not fully implemented. Returning JSON structure.',
      );
    }

    return exportData;
  }
}
