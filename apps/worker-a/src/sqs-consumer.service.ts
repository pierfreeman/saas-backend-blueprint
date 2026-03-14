import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import { WorkerController, HeavyJobPayload } from './worker.controller';

/**
 * SqsConsumerService
 * Long-polls the SQS Standard queue and dispatches events to the
 * appropriate handler in WorkerController.
 *
 * Runs on module init; stops cleanly on SIGTERM/SIGINT.
 *
 * Delivery guarantee:
 *   - Message is deleted **only** on successful processing.
 *   - On failure the message becomes visible again after the queue's
 *     VisibilityTimeout and is retried up to the MaxReceiveCount, after
 *     which SQS moves it to the configured Dead-Letter Queue (DLQ).
 *
 * Required environment variables:
 *   SQS_STANDARD_QUEUE_URL   URL of the SQS Standard queue to consume
 *   AWS_REGION               e.g. eu-west-1
 *   SQS_ENDPOINT_URL         (optional) LocalStack endpoint
 */
@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);

  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private running = false;

  constructor(private readonly workerController: WorkerController) {
    const region = process.env['AWS_REGION'] ?? 'eu-west-1';
    const endpoint = process.env['SQS_ENDPOINT_URL'];

    this.client = new SQSClient({
      region,
      ...(endpoint ? { endpoint } : {}),
    });

    this.queueUrl = process.env['SQS_STANDARD_QUEUE_URL'] ?? '';
  }

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn(
        'SQS_STANDARD_QUEUE_URL is not set — SQS consumer will not start. ' +
          'Set EVENT_BUS_TRANSPORT=local for local development.',
      );
      return;
    }

    this.running = true;
    this.logger.log(`SQS consumer started | queue: ${this.queueUrl}`);
    void this.poll();
  }

  onModuleDestroy(): void {
    this.logger.log('SQS consumer shutting down...');
    this.running = false;
  }

  /**
   * Long-poll loop. Runs continuously until onModuleDestroy() sets
   * this.running = false.
   *
   * WaitTimeSeconds=20 enables long-polling, reducing empty-receive costs.
   * MaxNumberOfMessages=10 is the SQS maximum per request.
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            AttributeNames: ['All'],
            MessageAttributeNames: ['All'],
          }),
        );

        const messages = result.Messages ?? [];

        await Promise.allSettled(
          messages.map((msg) => this.processMessage(msg)),
        );
      } catch (error) {
        if (this.running) {
          this.logger.error('SQS receive error — retrying in 5 s', error);
          await this.sleep(5000);
        }
      }
    }
  }

  /**
   * Deserialises the message body into a DomainEvent, dispatches it to the
   * correct handler, then deletes the message from the queue.
   * Errors during processing are logged; the message is NOT deleted so SQS
   * will redeliver it (up to MaxReceiveCount) and then route it to the DLQ.
   */
  private async processMessage(msg: Message): Promise<void> {
    if (!msg.Body || !msg.ReceiptHandle) return;

    let event: DomainEvent;

    try {
      event = JSON.parse(msg.Body) as DomainEvent;
      // SQS serialises Date fields as strings — rehydrate the timestamp.
      event.timestamp = new Date(event.timestamp);
    } catch {
      this.logger.error(
        `Failed to parse SQS message body — skipping (MessageId: ${msg.MessageId})`,
      );
      return;
    }

    this.logger.debug(
      `Processing "${event.eventType}" | eventId: ${event.eventId} | MessageId: ${msg.MessageId}`,
    );

    try {
      await this.dispatch(event);

      // Delete only after successful processing.
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        }),
      );

      this.logger.debug(`Deleted message ${msg.MessageId}`);
    } catch (error) {
      this.logger.error(
        `Handler failed for "${event.eventType}" (MessageId: ${msg.MessageId}) — message will be requeued`,
        error,
      );
      // Do not delete — SQS will make the message visible again.
    }
  }

  /**
   * Routes a DomainEvent to the appropriate WorkerController handler.
   * Extend this switch when new event types are added.
   *
   * TODO: Add consumer branches for billing.* FIFO events so that downstream
   * actions (transactional emails, Slack/webhook notifications, usage metering
   * updates) are triggered automatically after each billing lifecycle change.
   * The FIFO queue already receives these events from the API; only the
   * consumer-side handler is missing. Suggested cases to add:
   *   BILLING_CHECKOUT_COMPLETED  → send welcome / payment-confirmed email
   *   BILLING_PAYMENT_FAILED      → send dunning email, alert ops channel
   *   BILLING_SUBSCRIPTION_CANCELLED → send cancellation confirmation email
   * Note: worker-a currently polls SQS_STANDARD_QUEUE_URL (Standard queue);
   * billing events land on SQS_FIFO_QUEUE_URL — a second consumer loop or a
   * dedicated worker service is needed to drain the FIFO queue.
   */
  private async dispatch(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case DOMAIN_EVENTS.HEAVY_JOB_CREATED:
        await this.workerController.handleHeavyJobCreated(
          event as unknown as DomainEvent<HeavyJobPayload>,
        );
        break;

      case DOMAIN_EVENTS.ORG_DELETION_REQUESTED:
        await this.workerController.handleOrgDeletionRequested(event as any);
        break;

      default:
        this.logger.warn(
          `No handler registered for event type "${event.eventType}" — message will be deleted`,
        );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
