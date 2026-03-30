import { PrismaBusinessService } from '@libs/prisma-business';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Job, JobStatus, Prisma } from '@libs/prisma-business';

/**
 * JobRepository
 * Data-access layer for all job-related database operations.
 *
 * Encapsulates all Prisma calls on the `jobs` table, exposing
 * explicit state-machine transition methods instead of raw updates.
 *
 * State machine: PENDING → PROCESSING → DONE | FAILED
 */
@Injectable()
export class JobRepository {
  private readonly logger = new Logger(JobRepository.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Persists a new PENDING job record.
   */
  async create(
    jobId: string,
    orgId: string,
    type: string,
    payload: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    await this.prisma.job.create({
      data: {
        id: jobId,
        orgId,
        userId,
        type,
        status: JobStatus.PENDING,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    this.logger.debug(`Created job ${jobId} (${type}) for org ${orgId}`);
  }

  /**
   * Removes a job record (rollback on publish failure).
   * Silently ignores "record not found" errors.
   */
  async delete(jobId: string): Promise<void> {
    await this.prisma.job
      .delete({ where: { id: jobId } })
      .catch(() =>
        this.logger.warn(`Rollback failed — orphan job ${jobId} may exist`),
      );
  }

  /**
   * Finds a job by ID scoped to the given organisation.
   * Prevents cross-tenant data leakage (IDOR).
   *
   * @throws NotFoundException if the job does not exist or belongs to a different tenant.
   */
  async findByIdAndOrg(jobId: string, orgId: string): Promise<Job> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, orgId },
    });
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    return job;
  }

  /**
   * Transitions a job from PENDING → PROCESSING.
   */
  async markProcessing(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.PROCESSING,
        attempts: { increment: 1 },
        startedAt: new Date(),
      },
    });
    this.logger.debug(`Job ${jobId} → PROCESSING`);
  }

  /**
   * Transitions a job from PROCESSING → DONE, storing the result payload.
   */
  async markDone(
    jobId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.DONE,
        result: result as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    this.logger.debug(`Job ${jobId} → DONE`);
  }

  /**
   * Transitions a job from PROCESSING → FAILED, storing the error message.
   */
  async markFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error,
        finishedAt: new Date(),
      },
    });
    this.logger.debug(`Job ${jobId} → FAILED: ${error}`);
  }
}
