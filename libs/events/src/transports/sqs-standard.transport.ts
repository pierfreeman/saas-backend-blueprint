import { Injectable, Logger } from '@nestjs/common';
import {
  SendMessageCommand,
  SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { DomainEvent } from '../interfaces/domain-event.interface';
import { SqsBaseTransport } from './sqs-base.transport';

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
export class SqsStandardTransport extends SqsBaseTransport {
  protected readonly logger = new Logger(SqsStandardTransport.name);
  protected readonly queueEnvVar = 'SQS_STANDARD_QUEUE_URL';
  protected readonly logTag = 'STANDARD';
  protected readonly notConfiguredWarning =
    'SQS_STANDARD_QUEUE_URL is not configured — Standard events will be dropped';

  protected buildCommand(event: DomainEvent, body: string): SendMessageCommand {
    return new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: body,
      MessageAttributes: this.buildMessageAttributes(event),
    });
  }

  protected logSuccess(
    event: DomainEvent,
    result: SendMessageCommandOutput,
  ): void {
    this.logger.debug(
      `[SQS-STANDARD] Sent "${event.eventType}" | MessageId: ${result.MessageId}`,
    );
  }
}
