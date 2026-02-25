import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { REDIS_EVENTS, HeavyJobCreatedEvent } from '@libs/common';

/**
 * Worker Controller
 * Handles incoming events from Redis
 * Worker-Compute-B processes similar events with potentially different logic
 */
@Controller()
export class WorkerController {
  private readonly logger = new Logger(WorkerController.name);

  /**
   * Subscribe to heavy.job.created event
   * Process the payload and handle long-running computation
   *
   * TODO: Add actual computation logic specific to this worker, error handling, result persistence
   */
  @MessagePattern(REDIS_EVENTS.HEAVY_JOB_CREATED)
  async handleHeavyJobCreated(@Payload() payload: HeavyJobCreatedEvent) {
    this.logger.log(
      `[Worker-Compute-B] Received job: ${payload.jobId} from tenant: ${payload.tenantId}`,
    );
    this.logger.debug(`Job payload:`, payload);

    try {
      // TODO: Implement actual heavy computation here (different from Worker-Compute-A)
      // This is a placeholder where long-running operations would happen
      this.logger.log(`[Worker-Compute-B] Processing job ${payload.jobId}...`);

      // Simulate some computation
      await this.simulateComputation();

      this.logger.log(
        `[Worker-Compute-B] Job ${payload.jobId} completed successfully`,
      );

      // TODO: Publish result back via another Redis event or store in database
    } catch (error) {
      this.logger.error(
        `[Worker-Compute-B] Error processing job ${payload.jobId}:`,
        error,
      );
      // TODO: Implement error handling (retry, dead letter queue, etc.)
    }
  }

  /**
   * Placeholder for computation logic
   */
  private async simulateComputation(): Promise<void> {
    // Simulate work
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, Math.random() * 3000); // Random delay up to 3 seconds
    });
  }
}
