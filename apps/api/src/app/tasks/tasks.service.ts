import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateTaskDto } from './dto/create-task.dto';

/**
 * Tasks Service
 * Creates heavy computation jobs and publishes them onto the event bus.
 * The event is routed to SQS Standard (or LocalTransport in dev) by
 * EventBusService — no transport details leak into this service.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly eventBus: EventBusService) {}

  /**
   * Create a heavy job and emit a HEAVY_JOB_CREATED domain event.
   * @returns the generated jobId so the caller can track the job.
   */
  async createHeavyJob(
    tenantId: string,
    createTaskDto: CreateTaskDto,
  ): Promise<{ jobId: string }> {
    const jobId = randomUUID();

    try {
      await this.eventBus.publish({
        eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
        timestamp: new Date(),
        payload: { jobId, data: createTaskDto },
        tenantId,
      });
      this.logger.log(
        `Heavy job event published: ${jobId} for tenant: ${tenantId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish heavy job event: ${jobId}`, error);
      throw error;
    }

    return { jobId };
  }
}
