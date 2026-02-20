import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { OrganizationStatus } from '@prisma/client';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let prismaService: any;
  let _membershipsService: any;
  let eventBusService: any;

  const mockOrganization = {
    id: 'org-123',
    name: 'Test Organization',
    status: OrganizationStatus.ACTIVE,
    stripeCustomerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserId = 'user-123';

  beforeEach(async () => {
    const mockPrisma = {
      organization: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      membership: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(),
    } as any;

    const mockMemberships = {
      getMembershipOrThrow: jest.fn(),
    } as any;

    const mockEventBus = {
      emit: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: MembershipsService,
          useValue: mockMemberships,
        },
        {
          provide: EventBusService,
          useValue: mockEventBus,
        },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    prismaService = module.get(PrismaService);
    _membershipsService = module.get(MembershipsService);
    eventBusService = module.get(EventBusService);
  });

  describe('createOrganization', () => {
    it('should create organization with OWNER membership in transaction', async () => {
      const dto = { name: 'Test Organization' };

      prismaService.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          organization: {
            create: jest.fn().mockResolvedValue(mockOrganization),
          },
          membership: {
            create: jest.fn().mockResolvedValue({
              id: 'membership-123',
              userId: mockUserId,
              orgId: mockOrganization.id,
              role: 'OWNER',
            }),
          },
        } as never);
      });

      const result = await service.createOrganization(mockUserId, dto);

      expect(result).toEqual(mockOrganization);
      expect(prismaService.$transaction).toHaveBeenCalled();
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.created',
          organizationId: mockOrganization.id,
          userId: mockUserId,
          payload: expect.objectContaining({
            organizationId: mockOrganization.id,
            organizationName: mockOrganization.name,
            ownerId: mockUserId,
          }),
        }),
      );
    });

    it('should throw BadRequestException on transaction failure', async () => {
      const dto = { name: 'Test Organization' };

      prismaService.$transaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(service.createOrganization(mockUserId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(eventBusService.emit).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return organization when found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);

      const result = await service.findById(mockOrganization.id);

      expect(result).toEqual(mockOrganization);
      expect(prismaService.organization.findUnique).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
      });
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByUserId', () => {
    it('should return organizations for user', async () => {
      const mockMemberships = [
        {
          id: 'membership-1',
          userId: mockUserId,
          orgId: mockOrganization.id,
          role: 'OWNER',
          organization: mockOrganization,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      prismaService.membership.findMany.mockResolvedValue(mockMemberships as never);

      const result = await service.findByUserId(mockUserId);

      expect(result).toEqual([mockOrganization]);
      expect(prismaService.membership.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        include: { organization: true },
      });
    });

    it('should return empty array when user has no organizations', async () => {
      prismaService.membership.findMany.mockResolvedValue([]);

      const result = await service.findByUserId(mockUserId);

      expect(result).toEqual([]);
    });
  });

  describe('updateOrganization', () => {
    it('should update organization and emit audit event', async () => {
      const dto = { name: 'Updated Name' };
      const updatedOrg = { ...mockOrganization, name: dto.name };

      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      prismaService.organization.update.mockResolvedValue(updatedOrg);

      const result = await service.updateOrganization(mockOrganization.id, dto, mockUserId);

      expect(result).toEqual(updatedOrg);
      expect(prismaService.organization.update).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
        data: dto,
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.updated',
          organizationId: mockOrganization.id,
          userId: mockUserId,
          payload: expect.objectContaining({
            organizationId: mockOrganization.id,
            previousName: mockOrganization.name,
            newName: updatedOrg.name,
          }),
        }),
      );
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOrganization('non-existent', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOrganization', () => {
    it('should delete organization and emit audit event', async () => {
      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);
      prismaService.organization.delete.mockResolvedValue(mockOrganization);

      await service.deleteOrganization(mockOrganization.id, mockUserId);

      expect(prismaService.organization.delete).toHaveBeenCalledWith({
        where: { id: mockOrganization.id },
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.deleted',
          organizationId: mockOrganization.id,
          userId: mockUserId,
          payload: expect.objectContaining({
            organizationId: mockOrganization.id,
            organizationName: mockOrganization.name,
          }),
        }),
      );
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.deleteOrganization('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isActive', () => {
    it('should return true when organization is active', async () => {
      prismaService.organization.findUnique.mockResolvedValue(mockOrganization);

      const result = await service.isActive(mockOrganization.id);

      expect(result).toBe(true);
    });

    it('should return false when organization is suspended', async () => {
      const suspendedOrg = {
        ...mockOrganization,
        status: OrganizationStatus.SUSPENDED,
      };
      prismaService.organization.findUnique.mockResolvedValue(suspendedOrg);

      const result = await service.isActive(mockOrganization.id);

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when organization not found', async () => {
      prismaService.organization.findUnique.mockResolvedValue(null);

      await expect(service.isActive('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
