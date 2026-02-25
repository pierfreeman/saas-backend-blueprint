import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { TasksService } from './tasks/tasks.service';

@Module({
  imports: [PrismaModule, RedisModule, HealthModule],
  controllers: [AppController],
  providers: [AppService, TasksService],
})
export class AppModule {}
