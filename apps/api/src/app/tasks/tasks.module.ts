import { JobsModule } from '@libs/jobs';
import { RedisModule } from '@libs/redis';
import { RBACModule } from '@libs/rbac';
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { JobsGateway } from './gateway/jobs.gateway';

/**
 * TasksModule
 *
 * Imports:
 *   - RBACModule   — OrgContextGuard, RBACGuard, and their dependencies
 *   - JobsModule   — JobService for Job CRUD (TasksService + JobsGateway)
 *   - RedisModule  — PubSubService for the Redis Pub/Sub bridge (JobsGateway)
 *
 * EventBusService is injected globally by EventsModule (in AppModule).
 */
@Module({
  imports: [RBACModule, JobsModule, RedisModule],
  controllers: [TasksController],
  providers: [TasksService, JobsGateway],
})
export class TasksModule {}
