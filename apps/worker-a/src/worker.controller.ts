import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@libs/events';

/**
 * Job payload carried inside DomainEvent.payload for HEAVY_JOB_CREATED events.
 * Extends Record<string, unknown> to satisfy the DomainEvent<T> generic constraint.
 */
export interface HeavyJobPayload extends Record<string, unknown> {
  jobId: string;
  tenantId: string;
  data: Record<string, unknown>;
}

/**
 * WorkerController
 * Processes heavy computation jobs delivered via SQS.
 * Called by SqsConsumerService after it deserialises the DomainEvent from
 * the message body. Kept as @Injectable (not @Controller) so it can also be
 * instantiated directly in unit tests without the NestJS HTTP adapter.
 *
 * TODO: Replace simulateComputation() with real business logic.
 * TODO: Persist results to the database or publish a HEAVY_JOB_COMPLETED event.
 */
@Injectable()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  /**
   * Handles a HEAVY_JOB_CREATED domain event.
   * Errors are caught and logged — the caller (SqsConsumerService) decides
   * whether to delete the message or leave it for the DLQ.
   *
   * @throws when the underlying computation throws an unrecoverable error
   */
  async handleHeavyJobCreated(
    event: DomainEvent<HeavyJobPayload>,
  ): Promise<void> {
    const { jobId, tenantId } = event.payload;

    this.logger.log(
      `[Worker-Compute-A] Received job: ${jobId} from tenant: ${tenantId}`,
    );
    this.logger.debug('Job event:', event);

    try {
      // TODO: Implement actual heavy computation here
      this.logger.log(`[Worker-Compute-A] Processing job ${jobId}...`);

      await this.simulateComputation();

      this.logger.log(`[Worker-Compute-A] Job ${jobId} completed successfully`);
    } catch (error) {
      this.logger.error(
        `[Worker-Compute-A] Error processing job ${jobId}:`,
        error,
      );
      throw error; // re-throw so SqsConsumerService can handle DLQ logic
    }
  }

  /** Placeholder — replace with real computation logic. */
  private async simulateComputation(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.random() * 2000); // random delay up to 2 s
    });
  }
}
