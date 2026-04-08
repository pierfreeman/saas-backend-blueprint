import { Injectable, Logger } from '@nestjs/common';
import {
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { DomainEvent } from '../interfaces/domain-event.interface';
import { SqsBaseTransport } from './sqs-base.transport';

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
export class SqsFifoTransport extends SqsBaseTransport {
  protected readonly logger = new Logger(SqsFifoTransport.name);
  protected readonly queueEnvVar = 'SQS_FIFO_QUEUE_URL';
  protected readonly logTag = 'FIFO';
  protected readonly notConfiguredWarning =
    'SQS_FIFO_QUEUE_URL is not configured — FIFO events will be dropped';

  protected buildCommand(event: DomainEvent, body: string): SendMessageCommand {
    // MessageGroupId guarantees ordering within the group.
    // Defaults to tenantId to isolate sequences per tenant.
    const messageGroupId = event.messageGroupId ?? event.tenantId ?? 'default';

    // MessageDeduplicationId: uses eventId to prevent duplicates
    // within the 5-minute SQS FIFO deduplication window.
    const deduplicationId = event.eventId ?? messageGroupId;

    return new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      MessageGroupId: messageGroupId,
      MessageDeduplicationId: deduplicationId,
      MessageAttributes: this.buildMessageAttributes(event),
    });
  }

  protected logSuccess(
    event: DomainEvent,
    result: SendMessageCommandOutput,
  ): void {
    const messageGroupId = event.messageGroupId ?? event.tenantId ?? 'default';
    this.logger.debug(
      `[SQS-FIFO] Sent "${event.eventType}" | group: ${messageGroupId} | MessageId: ${result.MessageId}`,
    );
  }
}
