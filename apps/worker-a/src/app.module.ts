import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { EventsModule } from '@libs/events';
import { ObservabilityModule } from '@libs/observability';
import { OrgDeletionModule } from '@libs/org-deletion';
import { OrgExportModule } from '@libs/org-export';
import { WorkerController } from './worker.controller';
import { SqsConsumerService } from './sqs-consumer.service';

/**
 * Worker App Module
 * Standalone application context that processes jobs delivered via SQS.
 * Redis is still imported for cache and pub/sub socket channels.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    PrismaBusinessModule,
    RedisModule,
    EventsModule,
    OrgDeletionModule,
    OrgExportModule,
  ],
  providers: [WorkerController, SqsConsumerService],
})
export class AppModule {}
