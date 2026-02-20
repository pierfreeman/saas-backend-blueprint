import { Controller, Get, Post, Body, Param, UseGuards, Patch, Delete } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentOrgId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { Membership } from '@prisma/client';

@ApiTags('Memberships')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/memberships')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_INVITE])
  @ApiOperation({ summary: 'Invite a new member to organization' })
  async create(
    @CurrentOrgId() orgId: string,
    @Body() dto: CreateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.createMembership({ ...dto, orgId });
  }

  @Get()
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({ summary: 'Get all members in organization' })
  async findByOrg(@CurrentOrgId() orgId: string): Promise<Membership[]> {
    return this.membershipsService.findMembershipsByOrg(orgId);
  }

  @Patch(':id')
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE])
  @ApiOperation({ summary: 'Update member role or status' })
  @ApiParam({ name: 'id', description: 'Membership ID' })
  async update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.updateMembership(id, dto);
  }

  @Delete(':id')
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_REMOVE])
  @ApiOperation({ summary: 'Remove member from organization' })
  @ApiParam({ name: 'id', description: 'Membership ID' })
  async delete(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.membershipsService.deleteMembership(id);
    return { message: 'Membership deleted successfully' };
  }
}
