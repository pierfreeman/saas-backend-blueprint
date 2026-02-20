import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface DomainEvent {
  eventType: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  organizationId?: string;
  userId?: string;
}

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: DomainEvent): void {
    this.logger.debug(
      `Emitting event: ${event.eventType} for org: ${event.organizationId || 'N/A'}`,
    );
    this.eventEmitter.emit(event.eventType, event);
  }

  emitAsync(event: DomainEvent): Promise<unknown[]> {
    this.logger.debug(
      `Emitting async event: ${event.eventType} for org: ${event.organizationId || 'N/A'}`,
    );
    return this.eventEmitter.emitAsync(event.eventType, event);
  }

  on(eventType: string, listener: (event: DomainEvent) => void): void {
    this.eventEmitter.on(eventType, listener);
  }

  once(eventType: string, listener: (event: DomainEvent) => void): void {
    this.eventEmitter.once(eventType, listener);
  }

  removeListener(eventType: string, listener: (event: DomainEvent) => void): void {
    this.eventEmitter.removeListener(eventType, listener);
  }

  removeAllListeners(eventType?: string): void {
    this.eventEmitter.removeAllListeners(eventType);
  }
}
