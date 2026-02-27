import { Injectable, Logger, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainEvent } from './interfaces/domain-event.interface';
import { IEventTransport } from './transports/transport.interface';
import { FIFO_EVENT_PREFIXES } from './constants/event-routing.constants';

export const EVENT_TRANSPORT_LOCAL = 'EVENT_TRANSPORT_LOCAL';
export const EVENT_TRANSPORT_STANDARD = 'EVENT_TRANSPORT_STANDARD';
export const EVENT_TRANSPORT_FIFO = 'EVENT_TRANSPORT_FIFO';

/**
 * EventBusService
 * Main facade for publishing domain events throughout the system.
 *
 * Automatic routing:
 *   - LOCAL mode (EVENT_BUS_TRANSPORT=local): uses EventEmitter2 in-memory.
 *     Ideal for local development with no AWS infrastructure required.
 *
 *   - SQS mode (EVENT_BUS_TRANSPORT=sqs):
 *     → SQS FIFO     for critical events (billing.*, subscription.*, payment.*)
 *     → SQS Standard for all other events
 *
 * Uso:
 * ```typescript
 * await this.eventBus.publish({
 *   eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
 *   timestamp: new Date(),
 *   payload: { jobId: '123', data: {...} },
 *   tenantId: 'tenant-xyz',
 * });
 * ```
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly isLocal: boolean;

  constructor(
    @Inject(EVENT_TRANSPORT_LOCAL)
    private readonly localTransport: IEventTransport,

    @Inject(EVENT_TRANSPORT_STANDARD)
    private readonly standardTransport: IEventTransport,

    @Inject(EVENT_TRANSPORT_FIFO)
    private readonly fifoTransport: IEventTransport,
  ) {
    this.isLocal =
      (process.env['EVENT_BUS_TRANSPORT'] ?? 'local').toLowerCase() === 'local';

    this.logger.log(
      `EventBus initialized in mode: ${this.isLocal ? 'LOCAL (in-memory)' : 'SQS'}`,
    );
  }

  /**
   * Publishes an event to the appropriate transport.
   * Auto-generates eventId if not provided.
   *
   * @returns SQS messageId (undefined in local mode)
   */
  async publish(event: DomainEvent): Promise<string | undefined> {
    const enriched: DomainEvent = {
      ...event,
      eventId: event.eventId ?? randomUUID(),
      timestamp: event.timestamp ?? new Date(),
    };

    if (this.isLocal) {
      return this.localTransport.send(enriched);
    }

    const transport = this.isFifoEvent(enriched.eventType)
      ? this.fifoTransport
      : this.standardTransport;

    this.logger.debug(
      `Routing "${enriched.eventType}" → ${this.isFifoEvent(enriched.eventType) ? 'FIFO' : 'Standard'}`,
    );

    return transport.send(enriched);
  }

  /**
   * Determines whether an event should be routed to FIFO based on its prefix.
   * Prefixes are defined in FIFO_EVENT_PREFIXES.
   */
  private isFifoEvent(eventType: string): boolean {
    return FIFO_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));
  }
}
