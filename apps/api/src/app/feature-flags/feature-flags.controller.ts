import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { OrganizationEntitlements } from './interfaces/entitlements.interface';

@ApiTags('Feature Flags')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard)
@Controller('organizations/:orgId/entitlements')
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get plan entitlements for an organization',
    description:
      'Returns the full set of feature flags and the resolved plan tier ' +
      'for the organization. Result is cached in Redis.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Entitlements for the organization.',
    schema: {
      type: 'object',
      required: [
        'organizationId',
        'plan',
        'subscriptionStatus',
        'advancedAnalytics',
        'customReports',
        'apiAccess',
        'ssoEnabled',
        'prioritySupport',
      ],
      properties: {
        organizationId: { type: 'string', format: 'uuid' },
        plan: {
          type: 'string',
          enum: ['FREE', 'PRO', 'ENTERPRISE'],
          example: 'PRO',
        },
        subscriptionStatus: {
          type: 'string',
          enum: [
            'NONE',
            'TRIALING',
            'ACTIVE',
            'PAST_DUE',
            'CANCELED',
            'UNPAID',
            'INCOMPLETE',
            'INCOMPLETE_EXPIRED',
            'PAUSED',
          ],
          example: 'ACTIVE',
        },
        advancedAnalytics: { type: 'boolean', example: true },
        customReports: { type: 'boolean', example: true },
        apiAccess: { type: 'boolean', example: true },
        ssoEnabled: { type: 'boolean', example: false },
        prioritySupport: { type: 'boolean', example: false },
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
      'Caller has no active membership in the specified organization.',
  })
  async getEntitlements(
    @Param('orgId') orgId: string,
  ): Promise<OrganizationEntitlements> {
    return this.featureFlagsService.getEntitlements(orgId);
  }

  @Post('invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invalidate the entitlements cache for an organization',
    description:
      'Removes the cached entitlements from Redis. The next request to ' +
      'GET /entitlements will re-derive the entitlements from the database. ' +
      'Intended for administrative use or when a plan change must take effect immediately.',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cache invalidated successfully.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
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
      'Caller has no active membership in the specified organization.',
  })
  async invalidateCache(
    @Param('orgId') orgId: string,
  ): Promise<{ message: string }> {
    await this.featureFlagsService.invalidateEntitlements(orgId);
    return {
      message: `Entitlements cache invalidated for organization ${orgId}`,
    };
  }
}
