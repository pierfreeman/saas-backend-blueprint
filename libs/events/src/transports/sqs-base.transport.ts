import { Logger, OnModuleInit } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { IEventTransport } from './transport.interface';
import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * SqsBaseTransport
 *
 * Abstract base for SQS transports. Handles:
 *  - SQSClient initialisation from environment variables
 *  - Common `send()` flow: serialise → build command → dispatch → log
 *  - Shared MessageAttributes (EventType, TenantId)
 *
 * Concrete subclasses supply:
 *  - The queue-specific env var name and log tag
 *  - `buildCommand()` to add queue-type-specific params (e.g. FIFO group/dedup IDs)
 *  - `logSuccess()` to emit an appropriate debug line after a successful send
 */
export abstract class SqsBaseTransport
  implements IEventTransport, OnModuleInit
{
  /** NestJS logger — each subclass should initialise with its own class name. */
  protected abstract readonly logger: Logger;

  /** Environment variable that holds the queue URL, e.g. 'SQS_STANDARD_QUEUE_URL'. */
  protected abstract readonly queueEnvVar: string;

  /** Short label used in log messages, e.g. 'STANDARD' or 'FIFO'. */
  protected abstract readonly logTag: string;

  /** Warning emitted on init when the queue URL env var is absent. */
  protected abstract readonly notConfiguredWarning: string;

  protected client!: SQSClient;
  protected queueUrl!: string;

  onModuleInit(): void {
    const region = process.env['AWS_REGION'] ?? 'eu-west-1';
    const endpoint = process.env['SQS_ENDPOINT_URL'];

    this.client = new SQSClient({
      region,
      ...(endpoint ? { endpoint } : {}),
    });

    this.queueUrl = process.env[this.queueEnvVar] ?? '';

    if (this.queueUrl) {
      this.logger.log(
        `SQS ${this.logTag} Transport ready | region: ${region} | queue: ${this.queueUrl}`,
      );
    } else {
      this.logger.warn(this.notConfiguredWarning);
    }
  }

  async send(event: DomainEvent): Promise<string | undefined> {
    if (!this.queueUrl) {
      this.logger.warn(
        `[SQS-${this.logTag}] Queue URL not configured, dropping event "${event.eventType}"`,
      );
      return undefined;
    }

    const body = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    });

    const command = this.buildCommand(event, body);

    try {
      const result: SendMessageCommandOutput = await this.client.send(command);
      this.logSuccess(event, result);
      return result.MessageId;
    } catch (error) {
      this.logger.error(
        `[SQS-${this.logTag}] Failed to send "${event.eventType}":`,
        error,
      );
      throw error;
    }
  }

  /**
   * Returns the standard MessageAttributes shared by all SQS commands.
   * Subclasses may call this in their `buildCommand()` implementation.
   */
  protected buildMessageAttributes(
    event: DomainEvent,
  ): Record<string, { DataType: string; StringValue: string }> {
    return {
      EventType: {
        DataType: 'String',
        StringValue: event.eventType,
      },
      TenantId: {
        DataType: 'String',
        StringValue: event.tenantId ?? 'unknown',
      },
    };
  }

  /** Build the queue-type-specific SendMessageCommand. */
  protected abstract buildCommand(
    event: DomainEvent,
    body: string,
  ): SendMessageCommand;

  /** Emit a debug log after a successful send. */
  protected abstract logSuccess(
    event: DomainEvent,
    result: SendMessageCommandOutput,
  ): void;
}
