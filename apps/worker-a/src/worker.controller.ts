import { Injectable, Logger } from '@nestjs/common';
import { JobRepository } from '@libs/jobs';
import { PubSubService } from '@libs/redis';
import { DomainEvent, JobUpdateMessage } from '@libs/events';
import {
  OrgDeletionWorkerService,
  OrgDeletionRequestedEventPayload,
} from '@libs/org-deletion';
import {
  OrgExportWorkerService,
  OrgExportRequestedEventPayload,
} from '@libs/org-export';
import { JobStatus } from '@prisma/client';

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
    private readonly jobRepo: JobRepository,
    private readonly pubSub: PubSubService,
    private readonly orgDeletionWorker: OrgDeletionWorkerService,
    private readonly orgExportWorker: OrgExportWorkerService,
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
    await this.jobRepo.markProcessing(jobId);

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
      await this.jobRepo.markDone(jobId, result);

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
      await this.jobRepo.markFailed(jobId, message);

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
   * Handles organization deletion requests.
   * Delegates to OrgDeletionWorkerService for actual cleanup execution.
   */
  async handleOrgDeletionRequested(
    event: DomainEvent<OrgDeletionRequestedEventPayload>,
  ): Promise<void> {
    const { orgId, trigger, orgName, requestedAt } = event.payload;

    this.logger.log(
      `[Worker-Compute-A] Received org deletion request: ${orgId} | trigger: ${trigger}`,
    );

    // Execute the deletion workflow
    await this.orgDeletionWorker.executeDeletion(
      orgId,
      trigger,
      orgName,
      requestedAt,
    );
  }

  /**
   * Handles organization export requests.
   * Delegates to OrgExportWorkerService for export generation.
   */
  async handleOrgExportRequested(
    event: DomainEvent<OrgExportRequestedEventPayload>,
  ): Promise<void> {
    const { orgId, exportId, jobId, orgName, requestedByUserId, requestedAt } =
      event.payload;

    this.logger.log(
      `[Worker-Compute-A] Received org export request: ${exportId} for org ${orgId}`,
    );

    // Execute the export workflow
    await this.orgExportWorker.executeExport(
      orgId,
      exportId,
      jobId,
      orgName,
      requestedByUserId,
      requestedAt,
    );
  }
}
