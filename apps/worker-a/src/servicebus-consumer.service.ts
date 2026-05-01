import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  ServiceBusClient,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
} from '@azure/service-bus';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import {
  WorkerController,
  HeavyJobPayload,
  UserInvitedPayload,
  PlanChangedPayload,
  PaymentSucceededPayload,
  SubscriptionCancelledPayload,
} from './worker.controller';

/**
 * ServiceBusConsumerService
 * Polls the Azure Service Bus Standard queue and dispatches events to
 * the appropriate handler in WorkerController.
 *
 * Only activates when EVENT_BUS_TRANSPORT=servicebus and
 * SERVICEBUS_STANDARD_QUEUE_NAME is set.
 *
 * Delivery guarantee:
 *   - Message is completed (removed) **only** on successful processing.
 *   - On failure the message is abandoned so Service Bus makes it visible
 *     again after the lock timeout, up to the queue's MaxDeliveryCount,
 *     after which it is moved to the Dead-Letter Queue (DLQ).
 *
 * Required environment variables:
 *   SERVICEBUS_CONNECTION_STRING     Azure Service Bus connection string
 *   SERVICEBUS_STANDARD_QUEUE_NAME   Name of the standard (non-session) queue to consume
 *
 * NOTE: Session-enabled queue events (billing.*, subscription.*, payment.*)
 * require a dedicated session consumer. See the note on SqsConsumerService
 * for the equivalent production pattern.
 */
@Injectable()
export class ServiceBusConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ServiceBusConsumerService.name);

  private client!: ServiceBusClient;
  private receiver!: ServiceBusReceiver;
  private running = false;

  private readonly handlerMap: Partial<
    Record<string, (e: DomainEvent) => Promise<void>>
  > = {
    [DOMAIN_EVENTS.HEAVY_JOB_CREATED]: (e) =>
      this.workerController.handleHeavyJobCreated(
        e as unknown as DomainEvent<HeavyJobPayload>,
      ),
    [DOMAIN_EVENTS.ORG_DELETION_REQUESTED]: (e) =>
      this.workerController.handleOrgDeletionRequested(e as any),
    [DOMAIN_EVENTS.ORG_EXPORT_REQUESTED]: (e) =>
      this.workerController.handleOrgExportRequested(e as any),
    [DOMAIN_EVENTS.USER_INVITED]: (e) =>
      this.workerController.handleUserInvited(
        e as unknown as DomainEvent<UserInvitedPayload>,
      ),
    [DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED]: (e) =>
      this.workerController.handleBillingPlanChanged(
        e as unknown as DomainEvent<PlanChangedPayload>,
      ),
    [DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED]: (e) =>
      this.workerController.handleBillingPaymentSucceeded(
        e as unknown as DomainEvent<PaymentSucceededPayload>,
      ),
    [DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED]: (e) =>
      this.workerController.handleBillingSubscriptionCancelled(
        e as unknown as DomainEvent<SubscriptionCancelledPayload>,
      ),
  };

  constructor(private readonly workerController: WorkerController) {}

  onModuleInit(): void {
    const transport = process.env['EVENT_BUS_TRANSPORT'] ?? 'local';
    if (transport !== 'servicebus') {
      return; // SQS or local mode — this consumer is inactive
    }

    const connectionString = process.env['SERVICEBUS_CONNECTION_STRING'] ?? '';
    const queueName = process.env['SERVICEBUS_STANDARD_QUEUE_NAME'] ?? '';

    if (!connectionString || !queueName) {
      this.logger.warn(
        'SERVICEBUS_CONNECTION_STRING or SERVICEBUS_STANDARD_QUEUE_NAME is not set — ' +
          'Service Bus consumer will not start.',
      );
      return;
    }

    this.client = new ServiceBusClient(connectionString);
    this.receiver = this.client.createReceiver(queueName, {
      receiveMode: 'peekLock',
    });

    this.running = true;
    this.logger.log(`Service Bus consumer started | queue: ${queueName}`);
    void this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Service Bus consumer shutting down...');
    this.running = false;
    try {
      await this.receiver?.close();
      await this.client?.close();
    } catch {
      // Swallow shutdown errors — process is already exiting
    }
  }

  /**
   * Long-poll loop. Runs continuously until onModuleDestroy() sets
   * this.running = false.
   *
   * maxWaitTimeInMs=20000 prevents hot-polling when the queue is empty.
   * maxMessageCount=10 receives up to 10 messages per call.
   */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const messages = await this.receiver.receiveMessages(10, {
          maxWaitTimeInMs: 20000,
        });

        await Promise.allSettled(
          messages.map((msg) => this.processMessage(msg)),
        );
      } catch (error) {
        if (this.running) {
          this.logger.error(
            'Service Bus receive error — retrying in 5 s',
            error,
          );
          await this.sleep(5000);
        }
      }
    }
  }

  /**
   * Deserialises the message body into a DomainEvent, dispatches it to the
   * correct handler, then completes (removes) the message from the queue.
   *
   * On processing failure the message is abandoned so Service Bus will
   * redeliver it (up to MaxDeliveryCount) and then Dead-Letter it.
   */
  private async processMessage(msg: ServiceBusReceivedMessage): Promise<void> {
    let event: DomainEvent;

    try {
      const raw =
        typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
      event = raw as DomainEvent;
      // Service Bus serialises Date fields as strings — rehydrate the timestamp.
      event.timestamp = new Date(event.timestamp);
    } catch {
      this.logger.error(
        `Failed to parse Service Bus message body — dead-lettering (messageId: ${msg.messageId})`,
      );
      try {
        await this.receiver.deadLetterMessage(msg, {
          deadLetterReason: 'ParseFailure',
          deadLetterErrorDescription:
            'Could not parse message body as DomainEvent',
        });
      } catch {
        // If dead-letter fails, abandon and let MaxDeliveryCount handle it
        await this.receiver.abandonMessage(msg);
      }
      return;
    }

    this.logger.debug(
      `Processing "${event.eventType}" | eventId: ${event.eventId} | messageId: ${msg.messageId}`,
    );

    try {
      await this.dispatch(event);

      // Complete only after successful processing.
      await this.receiver.completeMessage(msg);
      this.logger.debug(`Completed message ${msg.messageId}`);
    } catch (error) {
      this.logger.error(
        `Handler failed for "${event.eventType}" (messageId: ${msg.messageId}) — message will be requeued`,
        error,
      );
      // Abandon → Service Bus makes the message visible again after lock timeout.
      await this.receiver.abandonMessage(msg);
    }
  }

  /**
   * Routes a DomainEvent to the appropriate WorkerController handler via
   * handlerMap. Unknown event types are logged and the message is completed.
   *
   * NOTE: Billing events (SUBSCRIPTION_PLAN_CHANGED, BILLING_PAYMENT_SUCCEEDED,
   * BILLING_SUBSCRIPTION_CANCELLED) are published to the session-enabled queue in
   * servicebus mode. A dedicated session consumer is required for full production
   * support. In local mode all events are dispatched in-process via LocalTransport.
   */
  private async dispatch(event: DomainEvent): Promise<void> {
    const handler = this.handlerMap[event.eventType];

    if (!handler) {
      this.logger.warn(
        `No handler registered for event type "${event.eventType}" — message will be completed`,
      );
      return;
    }

    await handler(event);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
