import { Test, TestingModule } from '@nestjs/testing';
import { PlayersService } from '../../src/modules/players/players.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('PlayersService', () => {
  let service: PlayersService;
  let prisma: any;
  let eventBus: any;
  let featureFlagsService: any;

  beforeEach(async () => {
    const mockPrisma = {
      player: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      team: {
        findFirst: jest.fn(),
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
        PlayersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    service = module.get<PlayersService>(PlayersService);
    prisma = module.get(PrismaService);
    eventBus = module.get(EventBusService);
    featureFlagsService = module.get(FeatureFlagsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPlayer', () => {
    it('should create a player successfully', async () => {
      const orgId = 'org-123';
      const dto = { firstName: 'Test', lastName: 'Player', teamId: 'team-123' };
      const mockTeam = { id: 'team-123', name: 'Test Team', orgId };
      const mockPlayer = {
        id: 'player-123',
        firstName: 'Test',
        lastName: 'Player',
        teamId: 'team-123',
        orgId,
      };

      prisma.player.count.mockResolvedValue(15);
      featureFlagsService.checkLimit.mockResolvedValue({
        allowed: true,
        current: 15,
        limit: 20,
      });
      prisma.team.findFirst.mockResolvedValue(mockTeam);
      prisma.player.create.mockResolvedValue(mockPlayer);

      const result = await service.createPlayer(orgId, dto);

      expect(result).toEqual(mockPlayer);
      expect(prisma.player.count).toHaveBeenCalledWith({ where: { orgId } });
      expect(featureFlagsService.checkLimit).toHaveBeenCalledWith(orgId, 'maxPlayers', 15);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: dto.teamId, orgId },
      });
      expect(prisma.player.create).toHaveBeenCalledWith({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          teamId: dto.teamId,
          orgId,
        },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'player.created',
          organizationId: orgId,
          payload: {
            playerId: mockPlayer.id,
            playerName: `${mockPlayer.firstName} ${mockPlayer.lastName}`,
            teamId: dto.teamId,
          },
        }),
      );
    });

    it('should throw BadRequestException when player limit reached', async () => {
      const orgId = 'org-123';
      const dto = { firstName: 'Test', lastName: 'Player', teamId: 'team-123' };

      prisma.player.count.mockResolvedValue(20);
      featureFlagsService.checkLimit.mockResolvedValue({
        allowed: false,
        current: 20,
        limit: 20,
      });

      await expect(service.createPlayer(orgId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(prisma.player.create).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when team not found in organization', async () => {
      const orgId = 'org-123';
      const dto = { firstName: 'Test', lastName: 'Player', teamId: 'team-123' };

      prisma.player.count.mockResolvedValue(10);
      featureFlagsService.checkLimit.mockResolvedValue({
        allowed: true,
        current: 10,
        limit: 20,
      });
      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.createPlayer(orgId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.player.create).not.toHaveBeenCalled();
      expect(eventBus.emit).not.toHaveBeenCalled();
    });
  });

  describe('findAllByOrg', () => {
    it('should return all players for an organization', async () => {
      const orgId = 'org-123';
      const mockPlayers = [
        {
          id: 'player-1',
          firstName: 'Player',
          lastName: 'One',
          orgId,
          team: { id: 'team-1', name: 'Team 1' },
        },
        {
          id: 'player-2',
          firstName: 'Player',
          lastName: 'Two',
          orgId,
          team: { id: 'team-2', name: 'Team 2' },
        },
      ];

      prisma.player.findMany.mockResolvedValue(mockPlayers);

      const result = await service.findAllByOrg(orgId);

      expect(result).toEqual(mockPlayers);
      expect(prisma.player.findMany).toHaveBeenCalledWith({
        where: { orgId },
        include: { team: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findAllByTeam', () => {
    it('should return all players for a team', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      const mockTeam = { id: teamId, name: 'Test Team', orgId };
      const mockPlayers = [
        { id: 'player-1', firstName: 'Player', lastName: 'One', teamId, orgId },
        { id: 'player-2', firstName: 'Player', lastName: 'Two', teamId, orgId },
      ];

      prisma.team.findFirst.mockResolvedValue(mockTeam);
      prisma.player.findMany.mockResolvedValue(mockPlayers);

      const result = await service.findAllByTeam(teamId, orgId);

      expect(result).toEqual(mockPlayers);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: teamId, orgId },
      });
      expect(prisma.player.findMany).toHaveBeenCalledWith({
        where: { teamId, orgId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should throw NotFoundException when team not found', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';

      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.findAllByTeam(teamId, orgId)).rejects.toThrow(NotFoundException);
      expect(prisma.player.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return player if found in organization', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const mockPlayer = {
        id: playerId,
        firstName: 'Test',
        lastName: 'Player',
        orgId,
        team: { id: 'team-1', name: 'Team 1' },
      };

      prisma.player.findFirst.mockResolvedValue(mockPlayer);

      const result = await service.findById(playerId, orgId);

      expect(result).toEqual(mockPlayer);
      expect(prisma.player.findFirst).toHaveBeenCalledWith({
        where: { id: playerId, orgId },
        include: { team: true },
      });
    });

    it('should throw NotFoundException if player not found', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';

      prisma.player.findFirst.mockResolvedValue(null);

      await expect(service.findById(playerId, orgId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlayer', () => {
    it('should update player successfully and emit audit event', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const userId = 'user-123';
      const dto = { firstName: 'Updated', lastName: 'Player' };
      const existingPlayer = {
        id: playerId,
        firstName: 'Old',
        lastName: 'Name',
        orgId,
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Team 1' },
      };
      const updatedPlayer = {
        id: playerId,
        firstName: 'Updated',
        lastName: 'Player',
        orgId,
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Team 1' },
      };

      prisma.player.findFirst.mockResolvedValue(existingPlayer);
      prisma.player.update.mockResolvedValue(updatedPlayer);

      const result = await service.updatePlayer(playerId, orgId, dto, userId);

      expect(result).toEqual(updatedPlayer);
      expect(prisma.player.update).toHaveBeenCalledWith({
        where: { id: playerId },
        data: dto,
        include: { team: true },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'player.updated',
          organizationId: orgId,
          userId: userId,
          payload: expect.objectContaining({
            playerId: playerId,
            previousTeamId: existingPlayer.teamId,
            newTeamId: updatedPlayer.teamId,
          }),
        }),
      );
    });

    it('should update player with new team', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const dto = { firstName: 'Updated', lastName: 'Player', teamId: 'team-2' };
      const existingPlayer = {
        id: playerId,
        firstName: 'Old',
        lastName: 'Name',
        orgId,
        team: { id: 'team-1', name: 'Team 1' },
      };
      const newTeam = { id: 'team-2', name: 'Team 2', orgId };
      const updatedPlayer = {
        id: playerId,
        firstName: 'Updated',
        lastName: 'Player',
        orgId,
        team: { id: 'team-2', name: 'Team 2' },
      };

      prisma.player.findFirst.mockResolvedValue(existingPlayer);
      prisma.team.findFirst.mockResolvedValue(newTeam);
      prisma.player.update.mockResolvedValue(updatedPlayer);

      const result = await service.updatePlayer(playerId, orgId, dto);

      expect(result).toEqual(updatedPlayer);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { id: 'team-2', orgId },
      });
    });

    it('should throw BadRequestException when new team not in organization', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const dto = { firstName: 'Test', lastName: 'Player', teamId: 'team-2' };
      const existingPlayer = {
        id: playerId,
        firstName: 'Test',
        lastName: 'Player',
        orgId,
        team: { id: 'team-1', name: 'Team 1' },
      };

      prisma.player.findFirst.mockResolvedValue(existingPlayer);
      prisma.team.findFirst.mockResolvedValue(null);

      await expect(service.updatePlayer(playerId, orgId, dto)).rejects.toThrow(BadRequestException);
      expect(prisma.player.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if player not found', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const dto = { firstName: 'Updated', lastName: 'Player' };

      prisma.player.findFirst.mockResolvedValue(null);

      await expect(service.updatePlayer(playerId, orgId, dto)).rejects.toThrow(NotFoundException);
      expect(prisma.player.update).not.toHaveBeenCalled();
    });
  });

  describe('deletePlayer', () => {
    it('should delete player successfully and emit audit event', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';
      const userId = 'user-123';
      const mockPlayer = {
        id: playerId,
        firstName: 'John',
        lastName: 'Doe',
        orgId,
        teamId: 'team-1',
        team: { id: 'team-1', name: 'Team 1' },
      };

      prisma.player.findFirst.mockResolvedValue(mockPlayer);
      prisma.player.delete.mockResolvedValue(mockPlayer);

      await service.deletePlayer(playerId, orgId, userId);

      expect(prisma.player.delete).toHaveBeenCalledWith({
        where: { id: playerId },
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'player.deleted',
          organizationId: orgId,
          userId: userId,
          payload: expect.objectContaining({
            playerId: playerId,
            playerName: `${mockPlayer.firstName} ${mockPlayer.lastName}`,
            teamId: mockPlayer.teamId,
          }),
        }),
      );
    });

    it('should throw NotFoundException if player not found', async () => {
      const orgId = 'org-123';
      const playerId = 'player-123';

      prisma.player.findFirst.mockResolvedValue(null);

      await expect(service.deletePlayer(playerId, orgId)).rejects.toThrow(NotFoundException);
      expect(prisma.player.delete).not.toHaveBeenCalled();
    });
  });

  describe('countByOrg', () => {
    it('should return player count for organization', async () => {
      const orgId = 'org-123';
      prisma.player.count.mockResolvedValue(42);

      const result = await service.countByOrg(orgId);

      expect(result).toBe(42);
      expect(prisma.player.count).toHaveBeenCalledWith({
        where: { orgId },
      });
    });

    it('should return 0 if organization has no players', async () => {
      const orgId = 'org-123';
      prisma.player.count.mockResolvedValue(0);

      const result = await service.countByOrg(orgId);

      expect(result).toBe(0);
    });
  });

  describe('countByTeam', () => {
    it('should return player count for team', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      prisma.player.count.mockResolvedValue(15);

      const result = await service.countByTeam(teamId, orgId);

      expect(result).toBe(15);
      expect(prisma.player.count).toHaveBeenCalledWith({
        where: { teamId, orgId },
      });
    });

    it('should return 0 if team has no players', async () => {
      const orgId = 'org-123';
      const teamId = 'team-123';
      prisma.player.count.mockResolvedValue(0);

      const result = await service.countByTeam(teamId, orgId);

      expect(result).toBe(0);
    });
  });
});
