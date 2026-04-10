import {
  AdminMembershipsService,
  PaginatedAdminMembersResult,
} from '@libs/admin/memberships';
import { AdminJwtAuthGuard, CurrentAdminUserId } from '@libs/admin/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AdminChangeRoleDto,
  AdminInviteMemberDto,
  AdminListMembersQueryDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@Controller('admin/organizations/:orgId/memberships')
export class AdminMembershipsController {
  constructor(
    private readonly adminMembershipsService: AdminMembershipsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List members of an organization (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated list of members.',
  })
  listMembers(
    @Param('orgId') orgId: string,
    @Query() query: AdminListMembersQueryDto,
  ): Promise<PaginatedAdminMembersResult> {
    const { limit = 20, offset = 0 } = query;
    return this.adminMembershipsService.listMembers(orgId, { limit, offset });
  }

  @Post()
  @ApiOperation({ summary: 'Invite a member to an organization (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Member invited.' })
  inviteMember(
    @Param('orgId') orgId: string,
    @Body() dto: AdminInviteMemberDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<unknown> {
    return this.adminMembershipsService.inviteMember({
      orgId,
      email: dto.email,
      role: dto.role,
      actorAdminId,
    });
  }

  @Patch(':membershipId/role')
  @ApiOperation({ summary: 'Change a member role (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'membershipId', description: 'Membership UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Role updated.' })
  changeRole(
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: AdminChangeRoleDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<unknown> {
    return this.adminMembershipsService.changeRole({
      orgId,
      membershipId,
      newRole: dto.newRole,
      actorAdminId,
    });
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from an organization (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'membershipId', description: 'Membership UUID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Member removed.',
  })
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('membershipId') membershipId: string,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<void> {
    await this.adminMembershipsService.removeMember({
      orgId,
      membershipId,
      actorAdminId,
    });
  }
}
