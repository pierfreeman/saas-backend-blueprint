import { SystemAdminGuard } from '@libs/admin/auth';
import { CurrentAdminUserId } from '@libs/admin/auth';
import {
  AdminOrganizationDetail,
  AdminOrganizationListItem,
  AdminOrganizationsService,
  PaginatedAdminOrganizationsResult,
} from '@libs/admin/organizations';
import { JwtAuthGuard } from '@libs/common';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  AdminProvisionOrgDto,
  ListOrganizationsQueryDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/organizations')
export class AdminOrganizationsController {
  constructor(private readonly adminOrgsService: AdminOrganizationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provision a new enterprise organization (admin)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Organization provisioned and owner invited.',
  })
  provisionOrganization(
    @Body() dto: AdminProvisionOrgDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<AdminOrganizationListItem> {
    return this.adminOrgsService.provisionOrganization(dto, actorAdminId);
  }

  @Get()
  @ApiOperation({ summary: 'List all organizations (admin)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated list of organizations.',
  })
  listOrganizations(
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<PaginatedAdminOrganizationsResult> {
    const { search, status, limit = 20, offset = 0 } = query;
    return this.adminOrgsService.listOrganizations(
      { search, status },
      { limit, offset },
    );
  }

  @Get(':orgId')
  @ApiOperation({ summary: 'Get organization detail / Customer 360 (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Full organization detail.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  getOrganizationDetail(
    @Param('orgId') orgId: string,
  ): Promise<AdminOrganizationDetail> {
    return this.adminOrgsService.getOrganizationDetail(orgId);
  }
}
