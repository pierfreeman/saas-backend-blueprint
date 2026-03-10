import { ActivityLogService } from '@libs/activity-log';
import { EventBusService } from '@libs/events';
import { PrismaBusinessService } from '@libs/prisma-business';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, JobStatus } from '@prisma/client';
import { DOMAIN_EVENTS } from '@libs/events';
import { ExportFormat } from './dto/create-export.dto';

@Injectable()
export class DataExportsService {
  private readonly logger = new Logger(DataExportsService.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly eventBus: EventBusService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Creates a data export job for an organization.
   * The job is created in PENDING status and an event is published to SQS
   * for async processing by the worker.
   *
   * @param orgId - Organization UUID
   * @param userId - Auth0 subject of the requesting user
   * @param format - Export format (JSON or CSV)
   * @returns The created job record
   */
  async createExport(
    orgId: string,
    userId: string,
    format: ExportFormat = ExportFormat.JSON,
  ): Promise<Job> {
    this.logger.log(
      `Creating data export job | orgId: ${orgId} | userId: ${userId} | format: ${format}`,
    );

    // Create job record in PENDING status
    const job = await this.prisma.job.create({
      data: {
        orgId,
        userId,
        type: 'data_export',
        status: JobStatus.PENDING,
        payload: {
          orgId,
          format,
          requestedBy: userId,
          requestedAt: new Date().toISOString(),
        },
      },
    });

    // Log activity
    await this.activityLog.logActivity({
      orgId,
      actorId: userId,
      action: 'data_export.requested',
      entityType: 'organization',
      entityId: orgId,
      metadata: {
        jobId: job.id,
        format,
      },
    });

    // Publish event to SQS for async processing
    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.DATA_EXPORT_REQUESTED,
      payload: {
        jobId: job.id,
        orgId,
        format,
      },
      timestamp: new Date(),
    });

    this.logger.log(`Data export job created | jobId: ${job.id}`);

    return job;
  }

  /**
   * Retrieves the status of a data export job.
   * Enforces tenant isolation by checking orgId.
   *
   * @param jobId - Job UUID
   * @param orgId - Organization UUID (for tenant isolation)
   * @returns The job record with current status
   * @throws NotFoundException if job doesn't exist or belongs to different org
   */
  async getExportStatus(jobId: string, orgId: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({
      where: {
        id: jobId,
        orgId,
        type: 'data_export',
      },
    });

    if (!job) {
      throw new NotFoundException(
        `Export job ${jobId} not found for organization ${orgId}`,
      );
    }

    return job;
  }
}
