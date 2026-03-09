import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { IEventTransport } from './transport.interface';
import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * SqsStandardTransport
 * Sends events to an SQS Standard queue.
 *
 * Characteristics:
 * - Unlimited throughput
 * - At-least-once delivery (consumers must be idempotent)
 * - No ordering guarantee
 *
 * Used for: compute jobs, notifications, exports, generic events.
 *
 * Required environment variables:
 *   SQS_STANDARD_QUEUE_URL   SQS Standard queue URL
 *   AWS_REGION               e.g. eu-west-1
 *   AWS_ACCESS_KEY_ID        (optional when using an IAM Role)
 *   AWS_SECRET_ACCESS_KEY    (optional when using an IAM Role)
 *   SQS_ENDPOINT_URL         (optional, for LocalStack in development)
 */
@Injectable()
export class SqsStandardTransport implements IEventTransport, OnModuleInit {
  private readonly logger = new Logger(SqsStandardTransport.name);
  private client!: SQSClient;
  private queueUrl!: string;

  onModuleInit(): void {
    const region = process.env['AWS_REGION'] ?? 'eu-west-1';
    const endpoint = process.env['SQS_ENDPOINT_URL'];

    this.client = new SQSClient({
      region,
      ...(endpoint ? { endpoint } : {}),
    });

    this.queueUrl = process.env['SQS_STANDARD_QUEUE_URL'] ?? '';

    if (this.queueUrl) {
      this.logger.log(
        `SQS Standard Transport ready | region: ${region} | queue: ${this.queueUrl}`,
      );
    } else {
      this.logger.warn(
        'SQS_STANDARD_QUEUE_URL is not configured — Standard events will be dropped',
      );
    }
  }

  async send(event: DomainEvent): Promise<string | undefined> {
    if (!this.queueUrl) {
      this.logger.warn(
        `[SQS-STANDARD] Queue URL not configured, dropping event "${event.eventType}"`,
      );
      return undefined;
    }

    const body = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    });

    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      // Custom attribute to allow consumer-side filtering by eventType
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
        `[SQS-STANDARD] Sent "${event.eventType}" | MessageId: ${result.MessageId}`,
      );
      return result.MessageId;
    } catch (error) {
      this.logger.error(
        `[SQS-STANDARD] Failed to send "${event.eventType}":`,
        error,
      );
      throw error;
    }
  }
}
