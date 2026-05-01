import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/jobs';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { EventsModule } from '@libs/events';
import { ObservabilityModule } from '@libs/observability';
import { OrgDeletionModule } from '@libs/org-deletion';
import { OrgExportModule } from '@libs/org-export';
import { MembershipsModule } from '@libs/memberships';
import { BillingModule } from '@libs/billing';
import { Auth0Module } from '@libs/auth0';
import { WorkerController } from './worker.controller';
import { SqsConsumerService } from './sqs-consumer.service';
import { ServiceBusConsumerService } from './servicebus-consumer.service';

/**
 * Worker App Module
 * Standalone application context that processes jobs delivered via SQS or Azure Service Bus.
 * Redis is still imported for cache and pub/sub socket channels.
 */
@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    JobsModule,
    RedisModule,
    EventsModule,
    OrgDeletionModule,
    OrgExportModule,
    Auth0Module,
    MembershipsModule,
    BillingModule,
  ],
  providers: [WorkerController, SqsConsumerService, ServiceBusConsumerService],
})
export class AppModule {}
