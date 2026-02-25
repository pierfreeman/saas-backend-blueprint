import { HeavyJobCreatedEvent, REDIS_EVENTS } from '@libs/common';
import { PubSubService } from '@libs/redis';
import { Injectable, Logger } from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';

/**
 * Tasks Service
 * Handles task creation and event publishing
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private readonly pubSubService: PubSubService) {}

  /**
   * Create a heavy job and publish event to Redis
   */
  async createHeavyJob(
    tenantId: string,
    createTaskDto: CreateTaskDto,
  ): Promise<{ jobId: string }> {
    const jobId = this.generateJobId();

    const event: HeavyJobCreatedEvent = {
      jobId,
      tenantId,
      payload: createTaskDto,
      createdAt: new Date(),
    };

    try {
      await this.pubSubService.publish(REDIS_EVENTS.HEAVY_JOB_CREATED, event);
      this.logger.log(
        `Heavy job event published: ${jobId} for tenant: ${tenantId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish heavy job event: ${jobId}`, error);
      throw error;
    }

    return { jobId };
  }

  /**
   * Generate unique job ID
   * TODO: Use better identifier strategy (snowflake, ulid, etc.)
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
