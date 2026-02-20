import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../../src/modules/audit/audit.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';

describe('AuditService', () => {
  let service: AuditService;
  let prismaService: any;
  let eventBusService: any;

  beforeEach(async () => {
    const mockPrisma = {
      auditEvent: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const mockEventBus = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    prismaService = module.get(PrismaService);
    eventBusService = module.get(EventBusService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('logEvent', () => {
    it('should create audit event and emit to event bus', async () => {
      const mockAuditEvent = {
        id: 'audit-123',
        type: 'test.event',
        orgId: 'org-123',
        userId: 'user-123',
        payload: { test: 'data' },
        createdAt: new Date(),
      };

      prismaService.auditEvent.create.mockResolvedValue(mockAuditEvent);

      const result = await service.logEvent('test.event', 'org-123', 'user-123', {
        test: 'data',
      });

      expect(result).toEqual(mockAuditEvent);
      expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'test.event',
          orgId: 'org-123',
          userId: 'user-123',
          payload: { test: 'data' },
        },
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'audit.logged',
          organizationId: 'org-123',
          userId: 'user-123',
          payload: expect.objectContaining({
            auditEventId: mockAuditEvent.id,
            type: 'test.event',
          }),
        }),
      );
    });
  });

  describe('Event Listeners', () => {
    beforeEach(() => {
      prismaService.auditEvent.create.mockResolvedValue({
        id: 'audit-123',
        type: 'test',
        orgId: 'org-123',
        userId: 'user-123',
        payload: {},
        createdAt: new Date(),
      });
    });

    describe('Organization Events', () => {
      it('should handle organization.updated event', async () => {
        const event = {
          eventType: 'organization.updated',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            organizationId: 'org-123',
            changes: { name: 'New Name' },
          },
        };

        await service.handleOrganizationUpdated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'organization.updated',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle organization.deleted event', async () => {
        const event = {
          eventType: 'organization.deleted',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            organizationId: 'org-123',
            organizationName: 'Test Org',
          },
        };

        await service.handleOrganizationDeleted(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'organization.deleted',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });
    });

    describe('Team Events', () => {
      it('should handle team.updated event', async () => {
        const event = {
          eventType: 'team.updated',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            teamId: 'team-123',
            previousName: 'Old Name',
            newName: 'New Name',
          },
        };

        await service.handleTeamUpdated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'team.updated',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle team.deleted event', async () => {
        const event = {
          eventType: 'team.deleted',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            teamId: 'team-123',
            teamName: 'Test Team',
          },
        };

        await service.handleTeamDeleted(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'team.deleted',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });
    });

    describe('Player Events', () => {
      it('should handle player.updated event', async () => {
        const event = {
          eventType: 'player.updated',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            playerId: 'player-123',
            changes: { name: 'New Name' },
          },
        };

        await service.handlePlayerUpdated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'player.updated',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle player.deleted event', async () => {
        const event = {
          eventType: 'player.deleted',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            playerId: 'player-123',
            playerFirstName: 'John',
            playerLastName: 'Doe',
          },
        };

        await service.handlePlayerDeleted(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'player.deleted',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });
    });

    describe('Billing Events', () => {
      it('should handle billing.checkout.created event', async () => {
        const event = {
          eventType: 'billing.checkout.created',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            sessionId: 'cs_123',
            priceId: 'price_123',
            amount: 9900,
          },
        };

        await service.handleBillingCheckoutCreated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'billing.checkout.created',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle billing.portal.created event', async () => {
        const event = {
          eventType: 'billing.portal.created',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            sessionId: 'ps_123',
            customerId: 'cus_123',
          },
        };

        await service.handleBillingPortalCreated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'billing.portal.created',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle billing.subscription.cancelled event', async () => {
        const event = {
          eventType: 'billing.subscription.cancelled',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            subscriptionId: 'sub_123',
            cancelAtPeriodEnd: true,
          },
        };

        await service.handleBillingSubscriptionCancelled(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'billing.subscription.cancelled',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });

      it('should handle billing.subscription.reactivated event', async () => {
        const event = {
          eventType: 'billing.subscription.reactivated',
          timestamp: new Date(),
          organizationId: 'org-123',
          userId: 'user-123',
          payload: {
            subscriptionId: 'sub_123',
          },
        };

        await service.handleBillingSubscriptionReactivated(event);

        expect(prismaService.auditEvent.create).toHaveBeenCalledWith({
          data: {
            type: 'billing.subscription.reactivated',
            orgId: 'org-123',
            userId: 'user-123',
            payload: event.payload,
          },
        });
      });
    });
  });

  describe('Query Methods', () => {
    it('should find audit events by organization', async () => {
      const mockEvents = [
        { id: 'audit-1', type: 'test', orgId: 'org-123' },
        { id: 'audit-2', type: 'test', orgId: 'org-123' },
      ];

      prismaService.auditEvent.findMany.mockResolvedValue(mockEvents);

      const result = await service.findByOrg('org-123', 50, 0);

      expect(result).toEqual(mockEvents);
      expect(prismaService.auditEvent.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-123' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should count audit events by organization', async () => {
      prismaService.auditEvent.count.mockResolvedValue(42);

      const result = await service.countByOrg('org-123');

      expect(result).toBe(42);
      expect(prismaService.auditEvent.count).toHaveBeenCalledWith({
        where: { orgId: 'org-123' },
      });
    });
  });
});
