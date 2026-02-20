import { Controller, Get, Post, Param, Query, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto';
import { SuspendOrganizationDto } from './dto/suspend-organization.dto';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  async getSystemStats(): Promise<{
    totalOrganizations: number;
    activeOrganizations: number;
    suspendedOrganizations: number;
    totalUsers: number;
    totalTeams: number;
    totalPlayers: number;
    totalSubscriptions: number;
    activeSubscriptions: number;
  }> {
    return this.adminService.getSystemStats();
  }

  @Get('organizations')
  async listOrganizations(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query() queryDto?: ListOrganizationsQueryDto,
  ): Promise<{
    organizations: unknown[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const effectiveLimit = limit || 50;
    const effectiveOffset = offset || 0;

    const result = await this.adminService.listOrganizations(
      effectiveLimit,
      effectiveOffset,
      queryDto?.status,
    );

    return {
      ...result,
      limit: effectiveLimit,
      offset: effectiveOffset,
    };
  }

  @Get('organizations/:id')
  async getOrganization(@Param('id') id: string): Promise<unknown> {
    return this.adminService.getOrganizationById(id);
  }

  @Post('organizations/:id/suspend')
  async suspendOrganization(
    @Param('id') id: string,
    @Body() dto: SuspendOrganizationDto,
  ): Promise<{ message: string; organization: unknown }> {
    const organization = await this.adminService.suspendOrganization(id, dto.reason);

    return {
      message: 'Organization suspended successfully',
      organization,
    };
  }

  @Post('organizations/:id/reactivate')
  async reactivateOrganization(
    @Param('id') id: string,
  ): Promise<{ message: string; organization: unknown }> {
    const organization = await this.adminService.reactivateOrganization(id);

    return {
      message: 'Organization reactivated successfully',
      organization,
    };
  }

  @Get('subscriptions')
  async listSubscriptions(
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<{
    subscriptions: unknown[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const effectiveLimit = limit || 50;
    const effectiveOffset = offset || 0;

    const result = await this.adminService.listSubscriptions(effectiveLimit, effectiveOffset);

    return {
      ...result,
      limit: effectiveLimit,
      offset: effectiveOffset,
    };
  }
}
