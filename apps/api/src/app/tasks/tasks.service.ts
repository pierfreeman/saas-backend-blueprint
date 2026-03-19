import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { JobService } from '@libs/jobs';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CreateTaskDto } from './dto/create-task.dto';

/**
 * Tasks Service
 *
 * Responsibilities:
 *   1. Persist a PENDING Job record in Postgres before enqueueing — this
 *      ensures the job is always queryable via GET /tasks/:jobId, even if
 *      the WebSocket connection is not established.
 *   2. Publish a HEAVY_JOB_CREATED domain event onto the event bus so the
 *      worker fleet can pick it up asynchronously.
 *   3. Roll back the persisted record if the publish step fails, preventing
 *      orphan PENDING rows.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly eventBus: EventBusService,
    private readonly jobRepo: JobService,
  ) {}

  /**
   * Creates a background job, persists it as PENDING, and enqueues the event.
   *
   * @param tenantId - organisation ID (maps to `jobs.org_id`)
   * @param createTaskDto - validated request payload forwarded to the worker
   * @param userId - Auth0 sub of the submitting user (optional)
   * @returns the generated jobId for client-side tracking
   */
  async createHeavyJob(
    tenantId: string,
    createTaskDto: CreateTaskDto,
    userId?: string,
  ): Promise<{ jobId: string }> {
    const jobId = randomUUID();

    // Step 1 — Persist PENDING record so the job is immediately queryable.
    await this.jobRepo.create(
      jobId,
      tenantId,
      'heavy_job',
      createTaskDto as unknown as Record<string, unknown>,
      userId,
    );

    try {
      // Step 2 — Enqueue via EventBus (SQS Standard in production, LocalTransport in dev).
      await this.eventBus.publish({
        eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
        timestamp: new Date(),
        payload: { jobId, data: createTaskDto, tenantId, userId },
        tenantId,
        userId,
      });

      this.logger.log(
        `Heavy job ${jobId} persisted and event published | tenant: ${tenantId}`,
      );
    } catch (error) {
      // Step 3 — Rollback: remove orphan PENDING row on publish failure.
      await this.jobRepo.delete(jobId);

      this.logger.error(`Failed to publish heavy job event: ${jobId}`, error);
      throw error;
    }

    return { jobId };
  }

  /**
   * Fetches the current status and result of a job.
   * Scoped to the given tenant to prevent cross-tenant data leakage (IDOR).
   *
   * @throws NotFoundException when the job does not exist or belongs to a different tenant
   */
  async findJobById(jobId: string, tenantId: string): Promise<Job> {
    return this.jobRepo.findByIdAndOrg(jobId, tenantId);
  }
}
