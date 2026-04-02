import { AdminEntitlementsService } from '@libs/admin/entitlements';
import type { OrganizationEntitlements } from '@libs/admin/entitlements';
import { JwtAuthGuard } from '@libs/common';
import { SystemAdminGuard, CurrentAdminUserId } from '@libs/admin/auth';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/organizations/:orgId/entitlements')
export class AdminEntitlementsController {
  constructor(
    private readonly adminEntitlementsService: AdminEntitlementsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get plan entitlements for an organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Entitlements returned.' })
  getEntitlements(
    @Param('orgId') orgId: string,
  ): Promise<OrganizationEntitlements> {
    return this.adminEntitlementsService.getEntitlements(orgId);
  }

  @Post('invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invalidate entitlements cache for an organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Cache invalidated.' })
  async invalidateCache(
    @Param('orgId') orgId: string,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<{ message: string }> {
    await this.adminEntitlementsService.invalidateCache(orgId, actorAdminId);
    return { message: 'Entitlements cache invalidated.' };
  }
}
