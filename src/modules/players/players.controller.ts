import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentOrgId, CurrentUserId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';
import { PlayersService } from './players.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { Player } from '@prisma/client';

@ApiTags('Players')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/players')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.PLAYER_CREATE])
  @ApiOperation({ summary: 'Create a new player' })
  async create(@CurrentOrgId() orgId: string, @Body() dto: CreatePlayerDto): Promise<Player> {
    return this.playersService.createPlayer(orgId, dto);
  }

  @Get()
  @RequirePermissions([PERMISSIONS.PLAYER_READ])
  @ApiOperation({ summary: 'Get all players in organization' })
  @ApiQuery({ name: 'teamId', required: false, description: 'Filter by team ID' })
  async findAll(
    @CurrentOrgId() orgId: string,
    @Query('teamId') teamId?: string,
  ): Promise<Player[]> {
    if (teamId) {
      return this.playersService.findAllByTeam(teamId, orgId);
    }
    return this.playersService.findAllByOrg(orgId);
  }

  @Get(':id')
  @RequirePermissions([PERMISSIONS.PLAYER_READ])
  @ApiOperation({ summary: 'Get player by ID' })
  @ApiParam({ name: 'id', description: 'Player ID' })
  async findOne(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<Player> {
    return this.playersService.findById(id, orgId);
  }

  @Patch(':id')
  @RequirePermissions([PERMISSIONS.PLAYER_UPDATE])
  @ApiOperation({ summary: 'Update player' })
  @ApiParam({ name: 'id', description: 'Player ID' })
  async update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlayerDto,
    @CurrentUserId() userId: string,
  ): Promise<Player> {
    return this.playersService.updatePlayer(id, orgId, dto, userId);
  }

  @Delete(':id')
  @RequirePermissions([PERMISSIONS.PLAYER_DELETE])
  @ApiOperation({ summary: 'Delete player' })
  @ApiParam({ name: 'id', description: 'Player ID' })
  async delete(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<{ message: string }> {
    await this.playersService.deletePlayer(id, orgId, userId);
    return { message: 'Player deleted successfully' };
  }
}
