import { Injectable, Logger } from '@nestjs/common';
import { ServiceBusMessage } from '@azure/service-bus';
import { DomainEvent } from '../interfaces/domain-event.interface';
import { ServiceBusBaseTransport } from './servicebus-base.transport';

/**
 * ServiceBusSessionTransport
 * Sends events to an Azure Service Bus session-enabled queue.
 *
 * Characteristics:
 * - Guaranteed ordered delivery per sessionId (equivalent to SQS FIFO MessageGroupId)
 * - At-least-once delivery
 * - messageId is used for client-side deduplication tracking
 *
 * Used for: billing, subscriptions, payments — events where strict ordering
 * per tenant or per group is a hard business requirement.
 *
 * Required environment variables:
 *   SERVICEBUS_CONNECTION_STRING    Azure Service Bus connection string
 *   SERVICEBUS_SESSION_QUEUE_NAME   Name of the session-enabled queue
 */
@Injectable()
export class ServiceBusSessionTransport extends ServiceBusBaseTransport {
  protected readonly logger = new Logger(ServiceBusSessionTransport.name);
  protected readonly queueEnvVar = 'SERVICEBUS_SESSION_QUEUE_NAME';
  protected readonly logTag = 'SESSION';
  protected readonly notConfiguredWarning =
    'SERVICEBUS_SESSION_QUEUE_NAME is not configured — Session events will be dropped';

  protected buildMessage(event: DomainEvent): ServiceBusMessage {
    // sessionId maps to SQS FIFO MessageGroupId: ensures ordered delivery per session.
    // Defaults to tenantId so each tenant's critical events are processed in order.
    const sessionId = event.messageGroupId ?? event.tenantId ?? 'default';

    return {
      body: {
        ...event,
        timestamp: event.timestamp.toISOString(),
      },
      sessionId,
      messageId: event.eventId,
      applicationProperties: {
        eventType: event.eventType,
        tenantId: event.tenantId ?? 'unknown',
      },
    };
  }

  protected logSuccess(event: DomainEvent): void {
    const sessionId = event.messageGroupId ?? event.tenantId ?? 'default';
    this.logger.debug(
      `[SB-SESSION] Sent "${event.eventType}" | sessionId: ${sessionId} | eventId: ${event.eventId}`,
    );
  }
}
