import { Controller, Get, UseGuards, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/guards/org-scope.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { OrganizationEntitlements } from './interfaces/entitlements.interface';

@ApiTags('Feature Flags')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/entitlements')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
export class FeatureFlagsController {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  @Get()
  async getEntitlements(@OrgId() orgId: string): Promise<OrganizationEntitlements> {
    return this.featureFlagsService.getEntitlements(orgId);
  }

  @Post('invalidate')
  async invalidateCache(@OrgId() orgId: string): Promise<{ message: string }> {
    await this.featureFlagsService.invalidateEntitlements(orgId);
    return { message: 'Entitlements cache invalidated' };
  }
}
