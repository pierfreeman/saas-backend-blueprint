import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { PubSubService } from '@libs/redis';
import { DomainEvent, JobUpdateMessage } from '@libs/events';
import { JobStatus, Prisma } from '@prisma/client';

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
}
