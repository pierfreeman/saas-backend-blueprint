import { DomainEvent } from '../interfaces/domain-event.interface';

/**
 * IEventTransport
 * Contract that every transport must implement.
 * Allows swapping LocalTransport ↔ SqsTransport without touching EventBusService.
 */
export interface IEventTransport {
  /**
   * Sends an event over the transport.
   * @returns the messageId assigned by the broker (undefined in local mode)
   */
  send(event: DomainEvent): Promise<string | undefined>;
}
