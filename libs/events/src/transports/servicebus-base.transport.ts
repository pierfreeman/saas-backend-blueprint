import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ServiceBusClient,
  ServiceBusSender,
  ServiceBusMessage,
} from '@azure/service-bus';
import { IEventTransport } from './transport.interface';
import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * ServiceBusBaseTransport
 *
 * Abstract base for Azure Service Bus transports. Handles:
 *  - ServiceBusClient and ServiceBusSender initialisation from environment variables
 *  - Common `send()` flow: build message → send → log
 *  - Graceful shutdown via onModuleDestroy
 *
 * Concrete subclasses supply:
 *  - The queue-name env var and log tag
 *  - `buildMessage()` to add queue-type-specific params (e.g. sessionId for ordered delivery)
 *  - `logSuccess()` to emit an appropriate debug line after a successful send
 */
export abstract class ServiceBusBaseTransport
  implements IEventTransport, OnModuleInit, OnModuleDestroy
{
  /** NestJS logger — each subclass must initialise with its own class name. */
  protected abstract readonly logger: Logger;

  /** Environment variable that holds the queue name, e.g. 'SERVICEBUS_STANDARD_QUEUE_NAME'. */
  protected abstract readonly queueEnvVar: string;

  /** Short label used in log messages, e.g. 'STANDARD' or 'SESSION'. */
  protected abstract readonly logTag: string;

  /** Warning emitted on init when the queue name env var is absent. */
  protected abstract readonly notConfiguredWarning: string;

  protected client!: ServiceBusClient;
  protected sender!: ServiceBusSender;
  protected queueName!: string;

  onModuleInit(): void {
    const connectionString = process.env['SERVICEBUS_CONNECTION_STRING'] ?? '';
    this.queueName = process.env[this.queueEnvVar] ?? '';

    if (connectionString && this.queueName) {
      this.client = new ServiceBusClient(connectionString);
      this.sender = this.client.createSender(this.queueName);
      this.logger.log(
        `Service Bus ${this.logTag} Transport ready | queue: ${this.queueName}`,
      );
    } else {
      this.logger.warn(this.notConfiguredWarning);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.sender?.close();
      await this.client?.close();
    } catch {
      // Swallow shutdown errors — process is already exiting
    }
  }

  async send(event: DomainEvent): Promise<string | undefined> {
    if (!this.sender) {
      this.logger.warn(
        `[SB-${this.logTag}] Sender not initialised, dropping event "${event.eventType}"`,
      );
      return undefined;
    }

    const message = this.buildMessage(event);

    try {
      await this.sender.sendMessages(message);
      this.logSuccess(event);
      return event.eventId;
    } catch (error) {
      this.logger.error(
        `[SB-${this.logTag}] Failed to send "${event.eventType}":`,
        error,
      );
      throw error;
    }
  }

  /**
   * Build the queue-type-specific ServiceBusMessage.
   * Standard messages omit sessionId; session messages include it for FIFO delivery.
   */
  protected abstract buildMessage(event: DomainEvent): ServiceBusMessage;

  /** Emit a debug log after a successful send. */
  protected abstract logSuccess(event: DomainEvent): void;
}
