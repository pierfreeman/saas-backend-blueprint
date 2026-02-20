import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentOrgId } from '../rbac/decorators/rbac-context.decorator';
import { PERMISSIONS } from '../rbac/constants/permissions.constants';
import { SubscriptionsService } from './subscriptions.service';
import { Subscription } from '@prisma/client';

@ApiTags('Subscriptions')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/subscription')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({ summary: 'Get organization subscription details' })
  async getSubscription(
    @CurrentOrgId() orgId: string,
  ): Promise<Subscription | { plan: string; status: string }> {
    const subscription = await this.subscriptionsService.findByOrgId(orgId);

    if (!subscription) {
      return {
        plan: 'FREE',
        status: 'ACTIVE',
      };
    }

    return subscription;
  }
}
