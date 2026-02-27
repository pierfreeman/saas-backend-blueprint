import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from 'eventemitter2';
import { IEventTransport } from './transport.interface';
import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * LocalTransport
 * In-memory transport for local development and testing.
 * Uses EventEmitter2 with wildcard support (e.g. "billing.*").
 *
 * Active when EVENT_BUS_TRANSPORT=local (default in development).
 * Requires no external infrastructure.
 */
@Injectable()
export class LocalTransport implements IEventTransport {
  private readonly logger = new Logger(LocalTransport.name);
  private readonly emitter: EventEmitter2;

  constructor() {
    this.emitter = new EventEmitter2({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
      verboseMemoryLeak: true,
    });
  }

  async send(event: DomainEvent): Promise<string | undefined> {
    this.logger.debug(
      `[LOCAL] emit "${event.eventType}" | tenant: ${event.tenantId ?? 'N/A'} | id: ${event.eventId}`,
    );
    this.emitter.emit(event.eventType, event);
    return undefined;
  }

  /**
   * Registers a listener for tests or in-process subscribers.
   * Supports wildcards: on('billing.*', handler)
   */
  on(eventType: string, handler: (event: DomainEvent) => void): void {
    this.emitter.on(eventType, handler);
  }

  off(eventType: string, handler: (event: DomainEvent) => void): void {
    this.emitter.off(eventType, handler);
  }
}
