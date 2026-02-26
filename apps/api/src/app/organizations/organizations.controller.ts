import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestUser } from '@libs/common';
import { AuthService } from '../auth/auth.service';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { PERMISSIONS } from '@libs/common';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Organization created successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<Organization> {
    const dbUser = await this.resolveUser(user.sub);
    return this.organizationsService.createOrganization(dbUser.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all organizations for the current user' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of organizations.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  async findMine(@CurrentUser() user: RequestUser): Promise<Organization[]> {
    const dbUser = await this.resolveUser(user.sub);
    return this.organizationsService.findByUserId(dbUser.id);
  }

  @Get(':id')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization details.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions.',
  })
  async findOne(@Param('id') id: string): Promise<Organization> {
    return this.organizationsService.findById(id);
  }

  @Patch(':id')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_MANAGE])
  @ApiOperation({ summary: 'Update an organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization updated.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const dbUser = await this.resolveUser(user.sub);
    return this.organizationsService.updateOrganization(id, dto, dbUser.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_MANAGE])
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Organization deleted.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  async delete(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    const dbUser = await this.resolveUser(user.sub);
    await this.organizationsService.deleteOrganization(id, dbUser.id);
    return { message: 'Organization deleted successfully' };
  }

  /** Resolves Auth0 sub → local DB user */
  private async resolveUser(auth0Id: string): Promise<{ id: string }> {
    const user = await this.authService.findUserByAuth0Id(auth0Id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
