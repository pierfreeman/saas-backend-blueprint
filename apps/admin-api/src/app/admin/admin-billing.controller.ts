import { AdminBillingOverview, AdminBillingService } from '@libs/admin/billing';
import { JwtAuthGuard } from '@libs/common';
import { SystemAdminGuard, CurrentAdminUserId } from '@libs/admin/auth';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import {
  AdminChangePlanDto,
  AdminExtendTrialDto,
  AdminGetPortalUrlDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('admin/organizations/:orgId/billing')
export class AdminBillingController {
  constructor(private readonly adminBillingService: AdminBillingService) {}

  @Get()
  @ApiOperation({ summary: 'Get billing overview for an organization (admin)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Billing overview returned.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  getBillingOverview(
    @Param('orgId') orgId: string,
  ): Promise<AdminBillingOverview> {
    return this.adminBillingService.getBillingOverview(orgId);
  }

  @Post('portal')
  @ApiOperation({
    summary: 'Create a Stripe portal session for an organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Portal URL returned.',
  })
  getPortalUrl(
    @Param('orgId') orgId: string,
    @Body() dto: AdminGetPortalUrlDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<{ url: string }> {
    return this.adminBillingService.getPortalUrl({
      orgId,
      returnUrl: dto.returnUrl,
      actorAdminId,
    });
  }

  @Patch('plan')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Change the Stripe subscription plan for an organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Plan change initiated in Stripe.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Organization has no active subscription.',
  })
  async changePlan(
    @Param('orgId') orgId: string,
    @Body() dto: AdminChangePlanDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<void> {
    return this.adminBillingService.changePlan(
      orgId,
      dto.priceId,
      actorAdminId,
      dto.reason,
    );
  }

  @Patch('trial')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Extend the Stripe trial end date for an organization (admin)',
  })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Trial extended in Stripe.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Organization not found.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Organization is not in TRIALING status.',
  })
  async extendTrial(
    @Param('orgId') orgId: string,
    @Body() dto: AdminExtendTrialDto,
    @CurrentAdminUserId() actorAdminId: string,
  ): Promise<void> {
    return this.adminBillingService.extendTrial(
      orgId,
      new Date(dto.trialEnd),
      actorAdminId,
    );
  }
}
