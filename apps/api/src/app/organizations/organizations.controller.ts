import { JwtAuthGuard, PERMISSIONS, RequestUser } from '@libs/common';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
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
import { Organization, MembershipRole } from '@prisma/client';
import { OrgDeletionService, DeletionTrigger } from '@libs/org-deletion';
import { OrgExportService } from '@libs/org-export';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { RequireRole } from '../rbac/decorators/require-role.decorator';
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
    private readonly orgDeletionService: OrgDeletionService,
    private readonly orgExportService: OrgExportService,
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

  @Post(':id/delete')
  @HttpCode(HttpStatus.ACCEPTED)
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequireRole(MembershipRole.OWNER)
  @ApiOperation({
    summary: 'Request organization deletion',
    description:
      'Schedules organization deletion with a retention period (default 30 days). ' +
      'The organization status is immediately set to PENDING_DELETION, ' +
      'but actual data deletion happens asynchronously after the retention period. ' +
      'This complies with GDPR Right to Erasure requirements. ' +
      'Only OWNER role can request deletion.',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Deletion request accepted and scheduled.',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Organization deletion requested successfully',
        },
        scheduledAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-04-13T14:06:00.000Z',
        },
      },
      required: ['message', 'scheduledAt'],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Organization is already being deleted or has been deleted.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only OWNER role can request organization deletion.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  async requestDeletion(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ message: string; scheduledAt: Date }> {
    const dbUser = await this.resolveUser(user.sub);
    await this.orgDeletionService.requestDeletion(
      id,
      DeletionTrigger.USER_REQUEST,
      dbUser.id,
    );

    // Fetch the organization to get the scheduled deletion time
    const org = await this.organizationsService.findById(id);

    return {
      message: 'Organization deletion requested successfully',
      scheduledAt: org.deletionScheduledAt!,
    };
  }

  @Post(':id/export')
  @HttpCode(HttpStatus.ACCEPTED)
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequireRole(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Request organization data export',
    description:
      'Requests a data export for the organization (GDPR Right to Data Portability). ' +
      'Creates an export job that will asynchronously generate a compressed JSON file ' +
      'containing all organization data. The export will be available for download via ' +
      'a signed URL for 24 hours. Only OWNER and ADMIN roles can request exports.',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Export request accepted and queued for processing.',
    schema: {
      type: 'object',
      properties: {
        exportId: {
          type: 'string',
          format: 'uuid',
          example: 'b2c3d4e5-f6g7-5890-bc12-de3456gh7890',
        },
        message: {
          type: 'string',
          example: 'Export request accepted',
        },
      },
      required: ['exportId', 'message'],
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only OWNER and ADMIN roles can request exports.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  async requestExport(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ exportId: string; message: string }> {
    const dbUser = await this.resolveUser(user.sub);
    const exportId = await this.orgExportService.requestExport(id, dbUser.id);

    return {
      exportId,
      message: 'Export request accepted',
    };
  }

  @Get(':id/exports/:exportId')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequireRole(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'Get export status',
    description:
      'Retrieves the status and details of a specific export. ' +
      'If the export is completed, includes a signed download URL.',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiParam({
    name: 'exportId',
    description: 'Export UUID',
    example: 'b2c3d4e5-f6g7-5890-bc12-de3456gh7890',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Export details retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only OWNER and ADMIN roles can view exports.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Export not found.',
  })
  async getExport(
    @Param('id') orgId: string,
    @Param('exportId') exportId: string,
  ) {
    return this.orgExportService.getExport(exportId, orgId);
  }

  @Get(':id/exports')
  @OrgScoped()
  @UseGuards(OrgContextGuard, RBACGuard)
  @RequireRole(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: 'List organization exports',
    description:
      'Lists all exports for the organization, ordered by creation date (newest first). ' +
      'Supports pagination.',
  })
  @ApiParam({
    name: 'id',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Export list retrieved successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Only OWNER and ADMIN roles can view exports.',
  })
  async listExports(
    @Param('id') orgId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.orgExportService.listExports(
      orgId,
      limit === undefined ? undefined : Number.parseInt(limit, 10),
      offset === undefined ? undefined : Number.parseInt(offset, 10),
    );
  }

  /** Resolves Auth0 sub → local DB user */
  private async resolveUser(auth0Id: string): Promise<{ id: string }> {
    const user = await this.authService.findUserByAuth0Id(auth0Id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
