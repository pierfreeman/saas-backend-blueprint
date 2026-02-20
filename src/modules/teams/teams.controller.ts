import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentOrgId, CurrentUserId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { Team } from '@prisma/client';

@ApiTags('Teams')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.TEAM_CREATE])
  @ApiOperation({ summary: 'Create a new team' })
  async create(@CurrentOrgId() orgId: string, @Body() dto: CreateTeamDto): Promise<Team> {
    return this.teamsService.createTeam(orgId, dto);
  }

  @Get()
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  @ApiOperation({ summary: 'Get all teams in organization' })
  async findAll(@CurrentOrgId() orgId: string): Promise<Team[]> {
    return this.teamsService.findAllByOrg(orgId);
  }

  @Get(':id')
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  @ApiOperation({ summary: 'Get team by ID' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async findOne(@CurrentOrgId() orgId: string, @Param('id') id: string): Promise<Team> {
    return this.teamsService.findById(id, orgId);
  }

  @Patch(':id')
  @RequirePermissions([PERMISSIONS.TEAM_UPDATE])
  @ApiOperation({ summary: 'Update team' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUserId() userId: string,
  ): Promise<Team> {
    return this.teamsService.updateTeam(id, orgId, dto, userId);
  }

  @Delete(':id')
  @RequirePermissions([PERMISSIONS.TEAM_DELETE])
  @ApiOperation({ summary: 'Delete team' })
  @ApiParam({ name: 'id', description: 'Team ID' })
  async delete(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @CurrentUserId() userId: string,
  ): Promise<{ message: string }> {
    await this.teamsService.deleteTeam(id, orgId, userId);
    return { message: 'Team deleted successfully' };
  }
}
