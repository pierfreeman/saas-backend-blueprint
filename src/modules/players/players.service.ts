import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Player } from '@prisma/client';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { EventBusService } from '../../events/event-bus.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Injectable()
export class PlayersService {
  private readonly logger = new Logger(PlayersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async createPlayer(orgId: string, dto: CreatePlayerDto): Promise<Player> {
    this.logger.log(
      `Creating player "${dto.firstName} ${dto.lastName}" for team ${dto.teamId} in organization ${orgId}`,
    );

    // Check player limit
    const currentCount = await this.countByOrg(orgId);
    const limitCheck = await this.featureFlagsService.checkLimit(orgId, 'maxPlayers', currentCount);

    if (!limitCheck.allowed) {
      throw new BadRequestException(
        `Player limit reached. Your plan allows ${limitCheck.limit} players, you currently have ${limitCheck.current}.`,
      );
    }

    // Verify team belongs to organization
    const team = await this.prisma.team.findFirst({
      where: {
        id: dto.teamId,
        orgId, // Always filter by orgId
      },
    });

    if (!team) {
      throw new BadRequestException('Team not found in this organization');
    }

    const player = await this.prisma.player.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        teamId: dto.teamId,
        orgId,
      },
    });

    // Emit audit event
    this.eventBus.emit({
      eventType: 'player.created',
      timestamp: new Date(),
      organizationId: orgId,
      payload: {
        playerId: player.id,
        playerName: `${player.firstName} ${player.lastName}`,
        teamId: dto.teamId,
      },
    });

    this.logger.log(`Player ${player.id} created successfully`);

    return player;
  }

  async findAllByOrg(orgId: string): Promise<Player[]> {
    return this.prisma.player.findMany({
      where: { orgId },
      include: { team: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllByTeam(teamId: string, orgId: string): Promise<Player[]> {
    // Verify team belongs to organization
    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        orgId,
      },
    });

    if (!team) {
      throw new NotFoundException('Team not found in this organization');
    }

    return this.prisma.player.findMany({
      where: {
        teamId,
        orgId, // Always filter by orgId
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, orgId: string): Promise<Player> {
    const player = await this.prisma.player.findFirst({
      where: {
        id,
        orgId, // Always filter by orgId
      },
      include: { team: true },
    });

    if (!player) {
      throw new NotFoundException(`Player ${id} not found`);
    }

    return player;
  }

  async updatePlayer(
    id: string,
    orgId: string,
    dto: UpdatePlayerDto,
    userId?: string,
  ): Promise<Player> {
    // Verify player exists and belongs to org
    const existingPlayer = await this.findById(id, orgId);

    // If teamId is being changed, verify new team belongs to org
    if (dto.teamId) {
      const team = await this.prisma.team.findFirst({
        where: {
          id: dto.teamId,
          orgId,
        },
      });

      if (!team) {
        throw new BadRequestException('Team not found in this organization');
      }
    }

    const updated = await this.prisma.player.update({
      where: { id },
      data: dto,
      include: { team: true },
    });

    // Emit player updated event
    this.eventBus.emit({
      eventType: 'player.updated',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        playerId: id,
        changes: dto,
        previousTeamId: existingPlayer.teamId,
        newTeamId: updated.teamId,
      },
    });

    this.logger.log(`Player ${id} updated in organization ${orgId}`);

    return updated;
  }

  async deletePlayer(id: string, orgId: string, userId?: string): Promise<void> {
    // Verify player exists and belongs to org
    const player = await this.findById(id, orgId);

    await this.prisma.player.delete({
      where: { id },
    });

    // Emit player deleted event
    this.eventBus.emit({
      eventType: 'player.deleted',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        playerId: id,
        playerName: `${player.firstName} ${player.lastName}`,
        teamId: player.teamId,
        deletedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Player ${id} deleted from organization ${orgId}`);
  }

  async countByOrg(orgId: string): Promise<number> {
    return this.prisma.player.count({
      where: { orgId },
    });
  }

  async countByTeam(teamId: string, orgId: string): Promise<number> {
    return this.prisma.player.count({
      where: {
        teamId,
        orgId, // Always filter by orgId
      },
    });
  }
}
