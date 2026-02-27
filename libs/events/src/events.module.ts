import { Module, Global } from '@nestjs/common';
import {
  EventBusService,
  EVENT_TRANSPORT_LOCAL,
  EVENT_TRANSPORT_STANDARD,
  EVENT_TRANSPORT_FIFO,
} from './event-bus.service';
import { LocalTransport } from './transports/local.transport';
import { SqsStandardTransport } from './transports/sqs-standard.transport';
import { SqsFifoTransport } from './transports/sqs-fifo.transport';

/**
 * EventsModule
 * Global module that registers EventBusService and the three transports.
 *
 * Marked as @Global() — import it once in AppModule and EventBusService
 * becomes available across the entire application.
 *
 * Configuration via environment variables:
 *   EVENT_BUS_TRANSPORT=local   → use LocalTransport (default, dev/test)
 *   EVENT_BUS_TRANSPORT=sqs     → use SQS Standard + FIFO
 *   SQS_STANDARD_QUEUE_URL      → SQS Standard queue URL
 *   SQS_FIFO_QUEUE_URL          → SQS FIFO queue URL
 *   AWS_REGION                  → e.g. eu-west-1
 *   SQS_ENDPOINT_URL            → (optional) for LocalStack
 */
@Global()
@Module({
  providers: [
    // Transports
    LocalTransport,
    SqsStandardTransport,
    SqsFifoTransport,

    // DI tokens for transport injection into EventBusService
    {
      provide: EVENT_TRANSPORT_LOCAL,
      useExisting: LocalTransport,
    },
    {
      provide: EVENT_TRANSPORT_STANDARD,
      useExisting: SqsStandardTransport,
    },
    {
      provide: EVENT_TRANSPORT_FIFO,
      useExisting: SqsFifoTransport,
    },

    // Main facade
    EventBusService,
  ],
  exports: [EventBusService, LocalTransport],
})
export class EventsModule {}
