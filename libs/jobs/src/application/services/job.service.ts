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

  async markProcessing(jobId: string): Promise<void> {
    return this.jobRepository.markProcessing(jobId);
  }

  async markDone(
    jobId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    return this.jobRepository.markDone(jobId, result);
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    return this.jobRepository.markFailed(jobId, error);
  }
}
