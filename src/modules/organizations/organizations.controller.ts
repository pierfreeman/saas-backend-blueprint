import { Controller, Get, Post, Body, Param, UseGuards, Patch, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '../auth/interfaces/request-user.interface';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { Organization } from '@prisma/client';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentUserId } from '../rbac/decorators/rbac-context.decorator';
import { CurrentOrgId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';

@ApiTags('Organizations')
@ApiBearerAuth('JWT-auth')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @UseGuards(JwtAuthGuard) // No org context needed for creating org
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<Organization> {
    const dbUser = await this.getUserFromAuth(user.sub);
    return this.organizationsService.createOrganization(dbUser.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get all organizations for current user' })
  @ApiResponse({ status: 200, description: 'Returns list of organizations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findMine(@CurrentUser() user: RequestUser): Promise<Organization[]> {
    const dbUser = await this.getUserFromAuth(user.sub);
    return this.organizationsService.findByUserId(dbUser.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiResponse({ status: 200, description: 'Returns organization details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findOne(@Param('id') id: string, @CurrentOrgId() orgId: string): Promise<Organization> {
    return this.organizationsService.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_MANAGE])
  @ApiOperation({ summary: 'Update organization' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ): Promise<Organization> {
    return this.organizationsService.updateOrganization(id, dto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_MANAGE])
  @ApiOperation({ summary: 'Delete organization' })
  @ApiParam({ name: 'id', description: 'Organization ID' })
  @ApiResponse({ status: 200, description: 'Organization deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async delete(
    @Param('id') id: string,
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
  ): Promise<{ message: string }> {
    await this.organizationsService.deleteOrganization(id, userId);
    return { message: 'Organization deleted successfully' };
  }

  private async getUserFromAuth(auth0Id: string): Promise<{ id: string }> {
    const { PrismaService } = await import('../../prisma/prisma.service');
    const prisma = new PrismaService();
    const user = await prisma.user.findUnique({ where: { auth0Id } });
    if (!user) throw new Error('User not found');
    return user;
  }
}
