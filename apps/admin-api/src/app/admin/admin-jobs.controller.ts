import { AdminJobsService, PaginatedAdminJobsResult } from '@libs/admin/jobs';
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
import { AdminListJobsQueryDto } from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin')
export class AdminJobsController {
  constructor(private readonly adminJobsService: AdminJobsService) {}

  @Get('organizations/:orgId/jobs')
  @ApiOperation({
    summary: 'List background jobs for a specific organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated list of jobs for the organization.',
  })
  getOrgJobs(
    @Param('orgId') orgId: string,
    @Query() query: AdminListJobsQueryDto,
  ): Promise<PaginatedAdminJobsResult> {
    return this.adminJobsService.getOrgJobs(orgId, query);
  }
}
