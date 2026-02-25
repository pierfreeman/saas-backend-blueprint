import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { TasksService } from './tasks/tasks.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [AppController, HealthController],
  providers: [AppService, TasksService],
})
export class AppModule {}
