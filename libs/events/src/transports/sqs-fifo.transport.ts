import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { IEventTransport } from './transport.interface';
import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * SqsFifoTransport
 * Sends events to an SQS FIFO queue (.fifo suffix is mandatory).
 *
 * Characteristics:
 * - Guaranteed ordering per MessageGroupId
 * - Exactly-once processing (5-minute deduplication window)
 * - Max 3,000 msg/s (or 300/s per MessageGroupId)
 *
 * Used for: billing, subscriptions, payments — events where
 * strict ordering is a hard business requirement.
 *
 * Required environment variables:
 *   SQS_FIFO_QUEUE_URL       SQS FIFO queue URL (must end in .fifo)
 *   AWS_REGION               e.g. eu-west-1
 *   AWS_ACCESS_KEY_ID        (optional when using an IAM Role)
 *   AWS_SECRET_ACCESS_KEY    (optional when using an IAM Role)
 *   SQS_ENDPOINT_URL         (optional, for LocalStack in development)
 */
@Injectable()
export class SqsFifoTransport implements IEventTransport, OnModuleInit {
  private readonly logger = new Logger(SqsFifoTransport.name);
  private client!: SQSClient;
  private queueUrl!: string;

  onModuleInit(): void {
    const region = process.env['AWS_REGION'] ?? 'eu-west-1';
    const endpoint = process.env['SQS_ENDPOINT_URL'];

    this.client = new SQSClient({
      region,
      ...(endpoint ? { endpoint } : {}),
    });

    this.queueUrl = process.env['SQS_FIFO_QUEUE_URL'] ?? '';

    if (!this.queueUrl) {
      this.logger.warn(
        'SQS_FIFO_QUEUE_URL is not configured — FIFO events will be dropped',
      );
    } else {
      this.logger.log(
        `SQS FIFO Transport ready | region: ${region} | queue: ${this.queueUrl}`,
      );
    }
  }

  async send(event: DomainEvent): Promise<string | undefined> {
    if (!this.queueUrl) {
      this.logger.warn(
        `[SQS-FIFO] Queue URL not configured, dropping event "${event.eventType}"`,
      );
      return undefined;
    }

    const body = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    });

    // MessageGroupId guarantees ordering within the group.
    // Defaults to tenantId to isolate sequences per tenant.
    const messageGroupId = event.messageGroupId ?? event.tenantId ?? 'default';

    // MessageDeduplicationId: uses eventId to prevent duplicates
    // within the 5-minute SQS FIFO deduplication window.
    const deduplicationId = event.eventId!;

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: deduplicationId,
      MessageAttributes: {
        EventType: {
          DataType: 'String',
          StringValue: event.eventType,
        },
        TenantId: {
          DataType: 'String',
          StringValue: event.tenantId ?? 'unknown',
        },
      },
    });

    try {
      const result: SendMessageCommandOutput = await this.client.send(command);
      this.logger.debug(
        `[SQS-FIFO] Sent "${event.eventType}" | group: ${messageGroupId} | MessageId: ${result.MessageId}`,
      );
      return result.MessageId;
    } catch (error) {
      this.logger.error(
        `[SQS-FIFO] Failed to send "${event.eventType}":`,
        error,
      );
      throw error;
    }
  }
}
