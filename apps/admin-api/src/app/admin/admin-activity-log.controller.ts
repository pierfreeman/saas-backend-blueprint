import {
  AdminActivityLogService,
  PaginatedAdminActivityResult,
} from '@libs/admin/activity-log';
import { JwtAuthGuard } from '@libs/common';
import { SystemAdminGuard } from '@libs/admin/auth';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
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
  AdminActivityQueryDto,
  AdminAllActivityQueryDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin')
export class AdminActivityLogController {
  constructor(
    private readonly adminActivityLogService: AdminActivityLogService,
  ) {}

  @Get('activity-log')
  @ApiOperation({ summary: 'List activity across all organizations (admin)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated cross-org activity log.',
  })
  getAllActivity(
    @Query() query: AdminAllActivityQueryDto,
  ): Promise<PaginatedAdminActivityResult> {
    return this.adminActivityLogService.getAllActivity(query);
  }

  @Get('organizations/:orgId/activity-log')
  @ApiOperation({
    summary: 'List activity for a specific organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated org activity log.',
  })
  getOrgActivity(
    @Param('orgId') orgId: string,
    @Query() query: AdminActivityQueryDto,
  ): Promise<PaginatedAdminActivityResult> {
    return this.adminActivityLogService.getOrgActivity(orgId, query);
  }
}
