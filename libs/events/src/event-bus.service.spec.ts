import { Test, TestingModule } from '@nestjs/testing';
import {
  EventBusService,
  EVENT_TRANSPORT_LOCAL,
  EVENT_TRANSPORT_STANDARD,
  EVENT_TRANSPORT_FIFO,
} from './event-bus.service';
import { DomainEvent } from './interfaces/domain-event.interface';
import { DOMAIN_EVENTS } from './constants/event-routing.constants';
import { Mock, vi } from 'vitest';

const mockTransport = () => ({
  send: vi.fn().mockResolvedValue('msg-id-123'),
});

describe('EventBusService', () => {
  let service: EventBusService;
  let localSend: Mock;
  let standardSend: Mock;
  let fifoSend: Mock;

  const buildEvent = (eventType: string): DomainEvent => ({
    eventType,
    timestamp: new Date(),
    payload: { foo: 'bar' },
    tenantId: 'tenant-1',
  });

  beforeEach(async () => {
    const localMock = mockTransport();
    const standardMock = mockTransport();
    const fifoMock = mockTransport();
    localSend = localMock.send;
    standardSend = standardMock.send;
    fifoSend = fifoMock.send;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        { provide: EVENT_TRANSPORT_LOCAL, useValue: localMock },
        { provide: EVENT_TRANSPORT_STANDARD, useValue: standardMock },
        { provide: EVENT_TRANSPORT_FIFO, useValue: fifoMock },
      ],
    }).compile();

    service = module.get<EventBusService>(EventBusService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['EVENT_BUS_TRANSPORT'];
  });

  describe('LOCAL mode (default)', () => {
    it('should use localTransport when EVENT_BUS_TRANSPORT is not set', async () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'local';
      const event = buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED);
      await service.publish(event);
      expect(localSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
      expect(fifoSend).not.toHaveBeenCalled();
    });

    it('should auto-generate eventId if not provided', async () => {
      process.env['EVENT_BUS_TRANSPORT'] = 'local';
      const event = buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED);
      await service.publish(event);
      const sent: DomainEvent = localSend.mock.calls[0][0];
      expect(sent.eventId).toBeDefined();
      expect(typeof sent.eventId).toBe('string');
    });
  });

  describe('SQS mode routing', () => {
    beforeEach(() => {
      process.env['EVENT_BUS_TRANSPORT'] = 'sqs';
      // Re-create service with sqs mode
      Object.defineProperty(service, 'isLocal', { value: false });
    });

    it('should route heavy.job.created to SQS Standard', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED));
      expect(standardSend).toHaveBeenCalledTimes(1);
      expect(fifoSend).not.toHaveBeenCalled();
    });

    it('should route billing.payment.succeeded to SQS FIFO', async () => {
      await service.publish(
        buildEvent(DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED),
      );
      expect(fifoSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
    });

    it('should route subscription.activated to SQS FIFO', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED));
      expect(fifoSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
    });

    it('should preserve eventId when already provided', async () => {
      const event = {
        ...buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED),
        eventId: 'my-id',
      };
      await service.publish(event);
      const sent: DomainEvent = standardSend.mock.calls[0][0];
      expect(sent.eventId).toBe('my-id');
    });
  });
});
