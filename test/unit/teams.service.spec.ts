import { Test, TestingModule } from '@nestjs/testing';
import { TeamsService } from '../../src/modules/teams/teams.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: any;
  let eventBus: any;
  let featureFlagsService: any;

  beforeEach(async () => {
    const mockPrisma = {
      team: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const mockEventBus = {
      emit: jest.fn(),
    };

    const mockFeatureFlagsService = {
      checkLimit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
    prisma = module.get(PrismaService);
    eventBus = module.get(EventBusService);
    featureFlagsService = module.get(FeatureFlagsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTeam', () => {
    it('should create a team successfully', async () => {
      const orgId = 'org-123';
      const dto = { name: 'Test Team' };
      const mockTeam = { id: 'team-123', name: 'Test Team', orgId };

      prisma.team.count.mockResolvedValue(5);
      featureFlagsService.checkLimit.mockResolvedValue({
        allowed: true,
        current: 5,
        limit: 10,
      });
      prisma.team.create.mockResolvedValue(mockTeam);

      const result = await service.createTeam(orgId, dto);

      expect(result).toEqual(mockTeam);
      expect(prisma.team.count).toHaveBeenCalledWith({ where: { orgId } });
      expect(featureFlagsService.checkLimit).toHaveBeenCalledWith(orgId, 'maxTeams', 5);
      expect(prisma.team.create).toHaveBeenCalledWith({
        data: { name: dto.name, orgId },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'team.created',
          organizationId: orgId,
          payload: {
            teamId: mockTeam.id,
            teamName: mockTeam.name,
          },
        }),
      );
    });

    it('should throw BadRequestException when team limit reached', async () => {
      const orgId = 'org-123';
      const dto = { name: 'Test Team' };

      prisma.team.count.mockResolvedValue(10);
      featureFlagsService.checkLimit.mockResolvedValue({
        allowed: false,
        current: 10,
        limit: 10,
      });

      await expect(service.createTeam(orgId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.team.create).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('findAllByOrg', () => {
    it('should return all teams for an organization', async () => {
      const orgId = 'org-123';
      const mockTeams = [
        { id: 'team-1', name: 'Team 1', orgId },
        { id: 'team-2', name: 'Team 2', orgId },
      ];

      prisma.team.findMany.mockResolvedValue(mockTeams);

      const result = await service.findAllByOrg(orgId);

      expect(result).toEqual(mockTeams);
      expect(prisma.team.findMany).toHaveBeenCalledWith({
        where: { orgId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findById', () => {
    it('should return team if found in organization', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      const mockTeam = { id: teamId, name: 'Test Team', orgId };

      prisma.team.findFirst.mockResolvedValue(mockTeam);

      const result = await service.findById(teamId, orgId);

      expect(result).toEqual(mockTeam);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: teamId, orgId },
      });
    });

    it('should throw NotFoundException if team not found', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';

      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.findById(teamId, orgId)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if team belongs to different org', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';

      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.findById(teamId, orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTeam', () => {
    it('should update team successfully and emit audit event', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      const userId = 'user-123';
      const dto = { name: 'Updated Team' };
      const existingTeam = { id: teamId, name: 'Old Name', orgId };
      const updatedTeam = { id: teamId, name: 'Updated Team', orgId };

      prisma.team.findFirst.mockResolvedValue(existingTeam);
      prisma.team.update.mockResolvedValue(updatedTeam);

      const result = await service.updateTeam(teamId, orgId, dto, userId);

      expect(result).toEqual(updatedTeam);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: teamId, orgId },
      });
      expect(prisma.team.update).toHaveBeenCalledWith({
        where: { id: teamId },
        data: { name: dto.name },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'team.updated',
          organizationId: orgId,
          userId: userId,
          payload: expect.objectContaining({
            teamId: teamId,
            previousName: existingTeam.name,
            newName: updatedTeam.name,
          }),
        }),
      );
    });

    it('should throw NotFoundException if team not found', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      const dto = { name: 'Updated Team' };

      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.updateTeam(teamId, orgId, dto)).rejects.toThrow(NotFoundException);
      expect(prisma.team.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteTeam', () => {
    it('should delete team successfully and emit audit event', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      const userId = 'user-123';
      const mockTeam = { id: teamId, name: 'Test Team', orgId };

      prisma.team.findFirst.mockResolvedValue(mockTeam);
      prisma.team.delete.mockResolvedValue(mockTeam);

      await service.deleteTeam(teamId, orgId, userId);

      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: teamId, orgId },
      });
      expect(prisma.team.delete).toHaveBeenCalledWith({
        where: { id: teamId },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'team.deleted',
          organizationId: orgId,
          userId: userId,
          payload: expect.objectContaining({
            teamId: teamId,
            teamName: mockTeam.name,
          }),
        }),
      );
    });

    it('should throw NotFoundException if team not found', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';

      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.deleteTeam(teamId, orgId)).rejects.toThrow(NotFoundException);
      expect(prisma.team.delete).not.toHaveBeenCalled();
    });
  });

  describe('countByOrg', () => {
    it('should return team count for organization', async () => {
      const orgId = 'org-123';
      prisma.team.count.mockResolvedValue(7);

      const result = await service.countByOrg(orgId);

      expect(result).toBe(7);
      expect(prisma.team.count).toHaveBeenCalledWith({
        where: { orgId },
      });
    });

    it('should return 0 if organization has no teams', async () => {
      const orgId = 'org-123';
      prisma.team.count.mockResolvedValue(0);

      const result = await service.countByOrg(orgId);

      expect(result).toBe(0);
    });
  });
});
