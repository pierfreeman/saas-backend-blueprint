import { Injectable } from '@nestjs/common';
import { Job } from '@prisma/client';
import { JobRepository } from '../../infrastructure/repositories/job.repository';

@Injectable()
export class JobService {
  constructor(private readonly jobRepository: JobRepository) {}

  async create(
    jobId: string,
    orgId: string,
    type: string,
    payload: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    return this.jobRepository.create(jobId, orgId, type, payload, userId);
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
