import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [PrismaModule, RedisModule, HealthModule, TasksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
