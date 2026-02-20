import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { MembershipRole } from '@prisma/client';

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prismaService: any;
  let eventBusService: any;

  const mockMembership = {
    id: 'membership-123',
    userId: 'user-123',
    orgId: 'org-123',
    role: MembershipRole.ADMIN,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      membership: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    } as any;

    const mockEventBus = {
      emit: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: EventBusService,
          useValue: mockEventBus,
        },
      ],
    }).compile();

    service = module.get<MembershipsService>(MembershipsService);
    prismaService = module.get(PrismaService);
    eventBusService = module.get(EventBusService);
  });

  describe('createMembership', () => {
    it('should create membership and emit event', async () => {
      const dto = {
        userId: mockMembership.userId,
        orgId: mockMembership.orgId,
        role: MembershipRole.ADMIN,
      };

      prismaService.membership.create.mockResolvedValue(mockMembership);

      const result = await service.createMembership(dto);

      expect(result).toEqual(mockMembership);
      expect(prismaService.membership.create).toHaveBeenCalledWith({
        data: dto,
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'membership.created',
          organizationId: dto.orgId,
          userId: dto.userId,
          payload: expect.objectContaining({
            membershipId: mockMembership.id,
            userId: dto.userId,
            orgId: dto.orgId,
            role: dto.role,
          }),
        }),
      );
    });
  });

  describe('findMembershipByUserAndOrg', () => {
    it('should return membership when found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.findMembershipByUserAndOrg(
        mockMembership.userId,
        mockMembership.orgId,
      );

      expect(result).toEqual(mockMembership);
      expect(prismaService.membership.findUnique).toHaveBeenCalledWith({
        where: {
          userId_orgId: {
            userId: mockMembership.userId,
            orgId: mockMembership.orgId,
          },
        },
      });
    });

    it('should return null when membership not found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(null);

      const result = await service.findMembershipByUserAndOrg('non-existent', 'non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getMembershipOrThrow', () => {
    it('should return membership when found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.getMembershipOrThrow(
        mockMembership.userId,
        mockMembership.orgId,
      );

      expect(result).toEqual(mockMembership);
    });

    it('should throw ForbiddenException when membership not found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(null);

      await expect(service.getMembershipOrThrow('non-existent', 'non-existent')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findMembershipsByOrg', () => {
    it('should return memberships for organization', async () => {
      const mockMemberships = [mockMembership];
      prismaService.membership.findMany.mockResolvedValue(mockMemberships as never);

      const result = await service.findMembershipsByOrg(mockMembership.orgId);

      expect(result).toEqual(mockMemberships);
      expect(prismaService.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: mockMembership.orgId },
        include: { user: true },
      });
    });
  });

  describe('findMembershipsByUser', () => {
    it('should return memberships for user', async () => {
      const mockMemberships = [mockMembership];
      prismaService.membership.findMany.mockResolvedValue(mockMemberships as never);

      const result = await service.findMembershipsByUser(mockMembership.userId);

      expect(result).toEqual(mockMemberships);
      expect(prismaService.membership.findMany).toHaveBeenCalledWith({
        where: { userId: mockMembership.userId },
        include: { organization: true },
      });
    });
  });

  describe('updateMembership', () => {
    it('should update membership and emit event', async () => {
      const dto = { role: MembershipRole.COACH };
      const updatedMembership = { ...mockMembership, role: MembershipRole.COACH };

      prismaService.membership.findUnique.mockResolvedValue(mockMembership);
      prismaService.membership.update.mockResolvedValue(updatedMembership);

      const result = await service.updateMembership(mockMembership.id, dto);

      expect(result).toEqual(updatedMembership);
      expect(prismaService.membership.update).toHaveBeenCalledWith({
        where: { id: mockMembership.id },
        data: dto,
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'membership.updated',
        }),
      );
    });

    it('should throw NotFoundException when membership not found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMembership('non-existent', { role: MembershipRole.COACH }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMembership', () => {
    it('should delete membership and emit event', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);
      prismaService.membership.delete.mockResolvedValue(mockMembership);

      await service.deleteMembership(mockMembership.id);

      expect(prismaService.membership.delete).toHaveBeenCalledWith({
        where: { id: mockMembership.id },
      });
      expect(eventBusService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'membership.deleted',
        }),
      );
    });

    it('should throw NotFoundException when membership not found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(null);

      await expect(service.deleteMembership('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasRole', () => {
    it('should return true when user has specified role', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.hasRole(mockMembership.userId, mockMembership.orgId, [
        MembershipRole.ADMIN,
      ]);

      expect(result).toBe(true);
    });

    it('should return false when user has different role', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.hasRole(mockMembership.userId, mockMembership.orgId, [
        MembershipRole.OWNER,
      ]);

      expect(result).toBe(false);
    });

    it('should return false when membership not found', async () => {
      prismaService.membership.findUnique.mockResolvedValue(null);

      const result = await service.hasRole('non-existent', 'non-existent', [MembershipRole.ADMIN]);

      expect(result).toBe(false);
    });
  });

  describe('isOwner', () => {
    it('should return true when user is owner', async () => {
      const ownerMembership = { ...mockMembership, role: MembershipRole.OWNER };
      prismaService.membership.findUnique.mockResolvedValue(ownerMembership);

      const result = await service.isOwner(mockMembership.userId, mockMembership.orgId);

      expect(result).toBe(true);
    });

    it('should return false when user is not owner', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.isOwner(mockMembership.userId, mockMembership.orgId);

      expect(result).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should return true when user is admin or owner', async () => {
      prismaService.membership.findUnique.mockResolvedValue(mockMembership);

      const result = await service.isAdmin(mockMembership.userId, mockMembership.orgId);

      expect(result).toBe(true);
    });

    it('should return false when user is coach or viewer', async () => {
      const coachMembership = { ...mockMembership, role: MembershipRole.COACH };
      prismaService.membership.findUnique.mockResolvedValue(coachMembership);

      const result = await service.isAdmin(mockMembership.userId, mockMembership.orgId);

      expect(result).toBe(false);
    });
  });
});
