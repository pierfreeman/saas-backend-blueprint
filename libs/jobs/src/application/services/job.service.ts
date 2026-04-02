import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { Job } from '@libs/prisma-business';
import { JobRepository } from '../../infrastructure/repositories/job.repository';

@Injectable()
export class JobService {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  async create(
    jobId: string,
    orgId: string,
    type: string,
    payload: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    await this.jobRepository.create(jobId, orgId, type, payload, userId);

    this.activityLog.logActivity({
      orgId,
      actorId: userId ?? 'system',
      action: 'job.created',
      entityType: 'job',
      entityId: jobId,
      metadata: { type },
    });
    this.legalAudit.recordEvent({
      eventType: 'job.created',
      orgId,
      triggerType: userId ? 'user' : 'system',
      metadata: { jobId, type, userId: userId ?? null },
    });
  }

  async delete(jobId: string): Promise<void> {
    return this.jobRepository.delete(jobId);
  }

  async findByIdAndOrg(jobId: string, orgId: string): Promise<Job> {
    return this.jobRepository.findByIdAndOrg(jobId, orgId);
  }

  async markProcessing(
    jobId: string,
    orgId?: string,
    userId?: string,
  ): Promise<void> {
    await this.jobRepository.markProcessing(jobId);

    if (orgId) {
      this.activityLog.logActivity({
        orgId,
        actorId: userId ?? 'system',
        action: 'job.processing',
        entityType: 'job',
        entityId: jobId,
      });
    }
  }

  async markDone(
    jobId: string,
    result: Record<string, unknown>,
    orgId?: string,
    userId?: string,
  ): Promise<void> {
    await this.jobRepository.markDone(jobId, result);

    if (orgId) {
      this.activityLog.logActivity({
        orgId,
        actorId: userId ?? 'system',
        action: 'job.completed',
        entityType: 'job',
        entityId: jobId,
      });
      this.legalAudit.recordEvent({
        eventType: 'job.completed',
        orgId,
        triggerType: 'system',
        metadata: { jobId, userId: userId ?? null },
      });
    }
  }

  async markFailed(
    jobId: string,
    error: string,
    orgId?: string,
    userId?: string,
  ): Promise<void> {
    await this.jobRepository.markFailed(jobId, error);

    if (orgId) {
      this.activityLog.logActivity({
        orgId,
        actorId: userId ?? 'system',
        action: 'job.failed',
        entityType: 'job',
        entityId: jobId,
        metadata: { error },
      });
      this.legalAudit.recordEvent({
        eventType: 'job.failed',
        orgId,
        triggerType: 'system',
        metadata: { jobId, error, userId: userId ?? null },
      });
    }
  }
}
