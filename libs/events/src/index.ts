// Module
export * from './events.module';

// Facade
export * from './event-bus.service';

// Interfaces
export * from './interfaces/domain-event.interface';

// Constants
export * from './constants/event-routing.constants';

// Transports (esposto per test e per LocalTransport.on() nei workers in-process)
export * from './transports/transport.interface';
export * from './transports/local.transport';
export * from './transports/sqs-standard.transport';
export * from './transports/sqs-fifo.transport';
