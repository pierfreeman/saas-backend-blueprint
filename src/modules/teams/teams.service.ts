import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Team } from '@prisma/client';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { EventBusService } from '../../events/event-bus.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async createTeam(orgId: string, dto: CreateTeamDto): Promise<Team> {
    this.logger.log(`Creating team "${dto.name}" for organization ${orgId}`);

    // Check team limit
    const currentCount = await this.countByOrg(orgId);
    const limitCheck = await this.featureFlagsService.checkLimit(orgId, 'maxTeams', currentCount);

    if (!limitCheck.allowed) {
      throw new BadRequestException(
        `Team limit reached. Your plan allows ${limitCheck.limit} teams, you currently have ${limitCheck.current}.`,
      );
    }

    const team = await this.prisma.team.create({
      data: {
        name: dto.name,
        orgId,
      },
    });

    // Emit audit event
    this.eventBus.emit({
      eventType: 'team.created',
      timestamp: new Date(),
      organizationId: orgId,
      payload: {
        teamId: team.id,
        teamName: team.name,
      },
    });

    this.logger.log(`Team ${team.id} created successfully`);

    return team;
  }

  async findAllByOrg(orgId: string): Promise<Team[]> {
    return this.prisma.team.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, orgId: string): Promise<Team> {
    const team = await this.prisma.team.findFirst({
      where: {
        id,
        orgId, // Always filter by orgId
      },
    });

    if (!team) {
      throw new NotFoundException(`Team ${id} not found`);
    }

    return team;
  }

  async updateTeam(id: string, orgId: string, dto: UpdateTeamDto, userId?: string): Promise<Team> {
    // Verify team exists and belongs to org
    const existingTeam = await this.findById(id, orgId);

    const updated = await this.prisma.team.update({
      where: { id },
      data: { name: dto.name },
    });

    // Emit team updated event
    this.eventBus.emit({
      eventType: 'team.updated',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        teamId: id,
        previousName: existingTeam.name,
        newName: updated.name,
      },
    });

    this.logger.log(`Team ${id} updated in organization ${orgId}`);

    return updated;
  }

  async deleteTeam(id: string, orgId: string, userId?: string): Promise<void> {
    // Verify team exists and belongs to org
    const team = await this.findById(id, orgId);

    await this.prisma.team.delete({
      where: { id },
    });

    // Emit team deleted event
    this.eventBus.emit({
      eventType: 'team.deleted',
      timestamp: new Date(),
      organizationId: orgId,
      userId: userId,
      payload: {
        teamId: id,
        teamName: team.name,
        deletedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Team ${id} deleted from organization ${orgId}`);
  }

  async countByOrg(orgId: string): Promise<number> {
    return this.prisma.team.count({
      where: { orgId },
    });
  }
}
