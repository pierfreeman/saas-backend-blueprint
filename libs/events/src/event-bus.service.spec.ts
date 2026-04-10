import { Test, TestingModule } from '@nestjs/testing';
import {
  EventBusService,
  EVENT_TRANSPORT_LOCAL,
  EVENT_TRANSPORT_STANDARD,
  EVENT_TRANSPORT_FIFO,
  EVENT_TRANSPORT_SB_STANDARD,
  EVENT_TRANSPORT_SB_SESSION,
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
  let sbStandardSend: Mock;
  let sbSessionSend: Mock;

  const buildEvent = (eventType: string): DomainEvent => ({
    eventType,
    timestamp: new Date(),
    payload: { foo: 'bar' },
    tenantId: 'tenant-1',
  });

  const buildModule = async (mode: 'local' | 'sqs' | 'servicebus') => {
    process.env['EVENT_BUS_TRANSPORT'] = mode;

    const localMock = mockTransport();
    const standardMock = mockTransport();
    const fifoMock = mockTransport();
    const sbStandardMock = mockTransport();
    const sbSessionMock = mockTransport();

    localSend = localMock.send;
    standardSend = standardMock.send;
    fifoSend = fifoMock.send;
    sbStandardSend = sbStandardMock.send;
    sbSessionSend = sbSessionMock.send;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventBusService,
        { provide: EVENT_TRANSPORT_LOCAL, useValue: localMock },
        { provide: EVENT_TRANSPORT_STANDARD, useValue: standardMock },
        { provide: EVENT_TRANSPORT_FIFO, useValue: fifoMock },
        { provide: EVENT_TRANSPORT_SB_STANDARD, useValue: sbStandardMock },
        { provide: EVENT_TRANSPORT_SB_SESSION, useValue: sbSessionMock },
      ],
    }).compile();

    return module.get<EventBusService>(EventBusService);
  };

  beforeEach(async () => {
    service = await buildModule('local');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['EVENT_BUS_TRANSPORT'];
  });

  describe('LOCAL mode (default)', () => {
    it('uses localTransport when EVENT_BUS_TRANSPORT=local', async () => {
      const event = buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED);
      await service.publish(event);
      expect(localSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
      expect(fifoSend).not.toHaveBeenCalled();
    });

    it('auto-generates eventId if not provided', async () => {
      const event = buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED);
      await service.publish(event);
      const sent: DomainEvent = localSend.mock.calls[0][0];
      expect(sent.eventId).toBeDefined();
      expect(typeof sent.eventId).toBe('string');
    });
  });

  describe('SQS mode routing', () => {
    beforeEach(async () => {
      service = await buildModule('sqs');
    });

    it('routes heavy.job.created to SQS Standard', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED));
      expect(standardSend).toHaveBeenCalledTimes(1);
      expect(fifoSend).not.toHaveBeenCalled();
    });

    it('routes billing.payment.succeeded to SQS FIFO', async () => {
      await service.publish(
        buildEvent(DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED),
      );
      expect(fifoSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
    });

    it('routes subscription.activated to SQS FIFO', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED));
      expect(fifoSend).toHaveBeenCalledTimes(1);
      expect(standardSend).not.toHaveBeenCalled();
    });

    it('preserves eventId when already provided', async () => {
      const event = {
        ...buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED),
        eventId: 'my-id',
      };
      await service.publish(event);
      const sent: DomainEvent = standardSend.mock.calls[0][0];
      expect(sent.eventId).toBe('my-id');
    });
  });

  describe('SERVICE BUS mode routing', () => {
    beforeEach(async () => {
      service = await buildModule('servicebus');
    });

    it('routes heavy.job.created to Service Bus Standard', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED));
      expect(sbStandardSend).toHaveBeenCalledTimes(1);
      expect(sbSessionSend).not.toHaveBeenCalled();
      expect(standardSend).not.toHaveBeenCalled();
      expect(localSend).not.toHaveBeenCalled();
    });

    it('routes billing.payment.succeeded to Service Bus Session', async () => {
      await service.publish(
        buildEvent(DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED),
      );
      expect(sbSessionSend).toHaveBeenCalledTimes(1);
      expect(sbStandardSend).not.toHaveBeenCalled();
    });

    it('routes subscription.activated to Service Bus Session', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED));
      expect(sbSessionSend).toHaveBeenCalledTimes(1);
      expect(sbStandardSend).not.toHaveBeenCalled();
    });

    it('does NOT use SQS transports in servicebus mode', async () => {
      await service.publish(buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED));
      expect(standardSend).not.toHaveBeenCalled();
      expect(fifoSend).not.toHaveBeenCalled();
    });

    it('auto-generates eventId if not provided', async () => {
      const event = buildEvent(DOMAIN_EVENTS.HEAVY_JOB_CREATED);
      await service.publish(event);
      const sent: DomainEvent = sbStandardSend.mock.calls[0][0];
      expect(sent.eventId).toBeDefined();
    });
  });
});
