import { Injectable } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ExportStatus, JobStatus, OrgExport } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface CreateExportJobInput {
  orgId: string;
  userId: string;
  exportEventType: string;
}

export interface CreateExportJobResult {
  exportId: string;
  jobId: string;
}

export interface OrgExportSummary {
  id: string;
  name: string;
  status: string;
}

export interface CompleteExportInput {
  exportId: string;
  jobId: string;
  downloadUrl: string;
  fileSize: number;
  expiresAt: Date;
  completedAt: Date;
}

export interface FailExportInput {
  exportId: string;
  jobId: string;
  error: string;
}

export type OrgExportData = {
  organization: unknown;
  memberships: unknown[];
  activityLogs: unknown[];
  jobs: unknown[];
  files: unknown[];
  notifications: unknown[];
};

/**
 * OrgExportRepository
 *
 * Isolates all database operations required by the organisation export domain.
 * Services inject this repository instead of PrismaBusinessService directly.
 */
@Injectable()
export class OrgExportRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findOrgById(orgId: string): Promise<OrgExportSummary | null> {
    return this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, status: true },
    });
  }

  async findExportRecord(exportId: string): Promise<OrgExport | null> {
    return this.prisma.orgExport.findUnique({ where: { id: exportId } });
  }

  async findExportByIdAndOrg(
    exportId: string,
    orgId: string,
  ): Promise<OrgExport | null> {
    return this.prisma.orgExport.findFirst({ where: { id: exportId, orgId } });
  }

  async findExportsByOrg(
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<OrgExport[]> {
    return this.prisma.orgExport.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Find exports whose signed URLs have expired. Used by the scheduler.
   */
  async findExpiredExports(now: Date): Promise<OrgExport[]> {
    return this.prisma.orgExport.findMany({
      where: {
        status: ExportStatus.COMPLETED,
        expiresAt: { lte: now },
      },
    });
  }

  async markExportExpired(exportId: string): Promise<void> {
    await this.prisma.orgExport.update({
      where: { id: exportId },
      data: { status: ExportStatus.EXPIRED },
    });
  }

  async markExportsExpiredBatch(ids: string[]): Promise<number> {
    const result = await this.prisma.orgExport.updateMany({
      where: { id: { in: ids } },
      data: { status: ExportStatus.EXPIRED },
    });
    return result.count;
  }

  /**
   * Create the Job and OrgExport records atomically in a single transaction.
   */
  async createJobAndExport(
    input: CreateExportJobInput,
  ): Promise<CreateExportJobResult> {
    const exportId = randomUUID();
    const jobId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await tx.job.create({
        data: {
          id: jobId,
          orgId: input.orgId,
          userId: input.userId,
          type: input.exportEventType,
          status: JobStatus.PENDING,
          payload: { orgId: input.orgId, exportId },
        },
      });

      await tx.orgExport.create({
        data: {
          id: exportId,
          orgId: input.orgId,
          jobId,
          requestedByUserId: input.userId,
          status: ExportStatus.PENDING,
        },
      });
    });

    return { exportId, jobId };
  }

  async markExportProcessing(exportId: string, jobId: string): Promise<void> {
    await this.prisma.orgExport.update({
      where: { id: exportId },
      data: { status: ExportStatus.PROCESSING },
    });
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
  }

  async completeExport(input: CompleteExportInput): Promise<void> {
    await this.prisma.orgExport.update({
      where: { id: input.exportId },
      data: {
        status: ExportStatus.COMPLETED,
        fileUrl: input.downloadUrl,
        fileSize: BigInt(input.fileSize),
        expiresAt: input.expiresAt,
        completedAt: input.completedAt,
      },
    });
    await this.prisma.job.update({
      where: { id: input.jobId },
      data: {
        status: JobStatus.DONE,
        result: {
          exportId: input.exportId,
          fileSize: input.fileSize,
          expiresAt: input.expiresAt.toISOString(),
        },
        finishedAt: new Date(),
      },
    });
  }

  async failExport(input: FailExportInput): Promise<void> {
    await this.prisma.orgExport.update({
      where: { id: input.exportId },
      data: {
        status: ExportStatus.FAILED,
        failedAt: new Date(),
        error: input.error,
      },
    });
    await this.prisma.job.update({
      where: { id: input.jobId },
      data: {
        status: JobStatus.FAILED,
        error: input.error,
        finishedAt: new Date(),
      },
    });
  }

  async findUserById(
    userId: string,
  ): Promise<{ id: string; email: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
  }

  /**
   * Aggregate all organisation data across relevant tables for GDPR export.
   * Queries run in parallel where possible for efficiency.
   * Returns raw Prisma objects — the caller is responsible for sanitisation.
   */
  async aggregateOrgData(orgId: string): Promise<OrgExportData> {
    const [
      organization,
      memberships,
      activityLogs,
      jobs,
      files,
      notifications,
    ] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: orgId } }),
      this.prisma.membership.findMany({
        where: { orgId },
        include: {
          user: {
            select: { id: true, email: true, auth0Id: true, createdAt: true },
          },
        },
      }),
      this.prisma.activityLog.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      this.prisma.job.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.file.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    return {
      organization,
      memberships,
      activityLogs,
      jobs,
      files,
      notifications,
    };
  }
}
