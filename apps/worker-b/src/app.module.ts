import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { WorkerController } from './worker.controller';

/**
 * Worker App Module
 * Microservice that processes heavy jobs via Redis pub/sub
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  controllers: [WorkerController],
})
export class AppModule {}
