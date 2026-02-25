import { RedisModule } from '@libs/redis';
import { TenantModule } from '@libs/common';
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [RedisModule, TenantModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
