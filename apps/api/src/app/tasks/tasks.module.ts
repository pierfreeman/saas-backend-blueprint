import { TenantModule } from '@libs/common';
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/**
 * TasksModule
 * Provides task creation and job dispatch via EventBusService.
 * EventBusService is injected globally by EventsModule (imported in AppModule);
 * no explicit import is needed here.
 */
@Module({
  imports: [TenantModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
