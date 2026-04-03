import { AdminEntitlementsService } from '@libs/admin/entitlements';
import type { EntitlementOverrideRecord } from '@libs/admin/entitlements';
import { JwtAuthGuard } from '@libs/common';
import { SystemAdminGuard, CurrentAdminUserId } from '@libs/admin/auth';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SetFeatureFlagOverrideDto } from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/organizations/:orgId/feature-flags')
export class AdminFeatureFlagsController {
  constructor(
    private readonly adminEntitlementsService: AdminEntitlementsService,
  ) {}

  @Patch()
  @ApiOperation({
    summary: 'Set or update a per-org entitlement override (admin)',
    description:
      'Upserts a single feature flag override for the organization. ' +
      'The override is layered on top of the plan defaults. ' +
      'Cache is invalidated automatically. ' +
      'reason is required. expiresAt is optional.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Override created or updated.',
  })
  async setOverride(
    @Param('orgId') orgId: string,
    @Body() dto: SetFeatureFlagOverrideDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<EntitlementOverrideRecord> {
    return this.adminEntitlementsService.setOverride(orgId, dto, actorAdminId);
  }

  @Delete(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a per-org entitlement override (admin)',
    description:
      'Deletes the override for the given feature flag key. ' +
      'The organization reverts to its plan-default value. ' +
      'Cache is invalidated automatically.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'key', description: 'Feature flag key to remove' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Override removed.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Override not found.',
  })
  async deleteOverride(
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<void> {
    await this.adminEntitlementsService.deleteOverride(
      orgId,
      key,
      actorAdminId,
    );
  }
}
