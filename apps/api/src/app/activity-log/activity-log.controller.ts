import type { PaginatedActivityLogResult } from '@libs/activity-log';
import { ActivityLogService } from '@libs/activity-log';
import { JwtAuthGuard, PERMISSIONS } from '@libs/common';
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
  OrgScoped,
  RequirePermissions,
  OrgContextGuard,
  RBACGuard,
} from '@libs/rbac';
import { ActivityLogQueryDto } from './dto/activity-log-query.dto';

@ApiTags('Activity Log')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('organizations/:orgId/activity-log')
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Get()
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @ApiOperation({
    summary: 'List activity logs for an organisation',
    description:
      'Returns a paginated, newest-first list of activity log entries scoped to the ' +
      'given organisation. Accessible only to members with OWNER or ADMIN role.',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organisation UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated activity logs returned successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller does not belong to this organisation or has insufficient role.',
  })
  async list(
    @Param('orgId') orgId: string,
    @Query() query: ActivityLogQueryDto,
  ): Promise<PaginatedActivityLogResult> {
    const effectiveLimit = Math.min(query.limit ?? 100, 500);
    const effectiveOffset = query.offset ?? 0;

    return this.activityLogService.findByOrg(orgId, {
      limit: effectiveLimit,
      offset: effectiveOffset,
      action: query.action || undefined,
      actions: query.actions
        ? query.actions
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
      entityType: query.entityType || undefined,
      actorId: query.actorId || undefined,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
    });
  }
}
