import { TenantModule } from '@libs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { JobsGateway } from './gateway/jobs.gateway';

/**
 * TasksModule
 *
 * Imports:
 *   - TenantModule  — @CurrentTenant decorator used in TasksController
 *   - PrismaModule  — PrismaService for Job CRUD (TasksService + JobsGateway)
 *   - RedisModule   — PubSubService for the Redis Pub/Sub bridge (JobsGateway)
 *
 * EventBusService is injected globally by EventsModule (in AppModule).
 */
@Module({
  imports: [TenantModule, PrismaBusinessModule, RedisModule],
  controllers: [TasksController],
  providers: [TasksService, JobsGateway],
})
export class TasksModule {}
