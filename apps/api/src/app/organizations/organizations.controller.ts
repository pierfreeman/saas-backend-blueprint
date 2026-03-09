import { JwtAuthGuard, PERMISSIONS, RequestUser } from '@libs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationsService } from './organizations.service';

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
  @ApiOperation({
    summary: 'Create a new organization',
    description:
      'Creates a new organization owned by the authenticated user. ' +
      'The caller is automatically added as a member with the OWNER role.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Organization created successfully.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        },
        name: { type: 'string', example: 'Acme Corp' },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'SUSPENDED'],
          example: 'ACTIVE',
        },
        stripeCustomerId: { type: 'string', nullable: true, example: null },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
      },
      required: ['id', 'name', 'status', 'createdAt', 'updatedAt'],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — name must be at least 3 characters.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<Organization> {
    const dbUser = await this.resolveUser(user.sub);
    return this.organizationsService.createOrganization(dbUser.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List organizations for the current user',
    description:
      'Returns all organizations the authenticated user belongs to, ' +
      'regardless of their role within each organization.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Array of organizations the caller is a member of.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
          },
          name: { type: 'string', example: 'Acme Corp' },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'SUSPENDED'],
            example: 'ACTIVE',
          },
          stripeCustomerId: { type: 'string', nullable: true, example: null },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-02-26T12:34:56.789Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-02-26T12:34:56.789Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async findMine(@CurrentUser() user: RequestUser): Promise<Organization[]> {
    const dbUser = await this.resolveUser(user.sub);
    return this.organizationsService.findByUserId(dbUser.id);
  }

  @Get(':id')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({
    summary: 'Get organization by ID',
    description:
      'Returns full details of a single organization. Requires ORG_READ permission.',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Organization details.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        },
        name: { type: 'string', example: 'Acme Corp' },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'SUSPENDED'],
          example: 'ACTIVE',
        },
        stripeCustomerId: { type: 'string', nullable: true, example: null },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller does not belong to this organization or lacks ORG_READ permission.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  async findOne(@Param('id') id: string): Promise<Organization> {
    return this.organizationsService.findById(id);
  }

  @Patch(':id')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequirePermissions([PERMISSIONS.ORG_MANAGE])
  @ApiOperation({
    summary: 'Update an organization',
    description:
      'Updates mutable fields (name, status) of an organization. ' +
      'Requires ORG_MANAGE permission (OWNER or ADMIN).',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated organization object.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        },
        name: { type: 'string', example: 'Acme Corp Renamed' },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'SUSPENDED'],
          example: 'ACTIVE',
        },
        stripeCustomerId: { type: 'string', nullable: true, example: null },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T13:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — check the request body.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller lacks ORG_MANAGE permission.',
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
  @ApiOperation({
    summary: 'Delete an organization',
    description:
      'Permanently deletes an organization and all its associated data ' +
      '(memberships, audit events). This action is irreversible. ' +
      'Requires ORG_MANAGE permission (OWNER only).',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Organization deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Organization deleted successfully',
        },
      },
      required: ['message'],
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller lacks ORG_MANAGE permission.',
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
