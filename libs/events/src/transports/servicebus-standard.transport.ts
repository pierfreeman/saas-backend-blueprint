import { Injectable, Logger } from '@nestjs/common';
import { ServiceBusMessage } from '@azure/service-bus';
import { DomainEvent } from '../interfaces/domain-event.interface';
import { ServiceBusBaseTransport } from './servicebus-base.transport';

/**
 * ServiceBusStandardTransport
 * Sends events to an Azure Service Bus standard queue (no Session support).
 *
 * Characteristics:
 * - At-least-once delivery (consumers must be idempotent)
 * - No ordering guarantee
 * - High throughput
 *
 * Used for: compute jobs, notifications, exports, generic domain events.
 *
 * Required environment variables:
 *   SERVICEBUS_CONNECTION_STRING      Azure Service Bus connection string
 *   SERVICEBUS_STANDARD_QUEUE_NAME    Name of the standard queue
 */
@Injectable()
export class ServiceBusStandardTransport extends ServiceBusBaseTransport {
  protected readonly logger = new Logger(ServiceBusStandardTransport.name);
  protected readonly queueEnvVar = 'SERVICEBUS_STANDARD_QUEUE_NAME';
  protected readonly logTag = 'STANDARD';
  protected readonly notConfiguredWarning =
    'SERVICEBUS_STANDARD_QUEUE_NAME is not configured — Standard events will be dropped';

  protected buildMessage(event: DomainEvent): ServiceBusMessage {
    return {
      body: {
        ...event,
        timestamp: event.timestamp.toISOString(),
      },
      messageId: event.eventId,
      applicationProperties: {
        eventType: event.eventType,
        tenantId: event.tenantId ?? 'unknown',
      },
    };
  }

  protected logSuccess(event: DomainEvent): void {
    this.logger.debug(
      `[SB-STANDARD] Sent "${event.eventType}" | eventId: ${event.eventId}`,
    );
  }
}
