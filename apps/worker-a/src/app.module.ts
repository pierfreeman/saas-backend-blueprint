import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { EventsModule } from '@libs/events';
import { WorkerController } from './worker.controller';
import { SqsConsumerService } from './sqs-consumer.service';

/**
 * Worker App Module
 * Standalone application context that processes jobs delivered via SQS.
 * Redis is still imported for cache and pub/sub socket channels.
 */
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, EventsModule],
  providers: [WorkerController, SqsConsumerService],
})
export class AppModule {}
