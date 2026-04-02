import { AdminBillingOverview, AdminBillingService } from '@libs/admin/billing';
import { JwtAuthGuard } from '@libs/common';
import { SystemAdminGuard, CurrentAdminUserId } from '@libs/admin/auth';
import {
  Body,
  Controller,
  Get,
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
import { AdminGetPortalUrlDto } from './dto/admin.dto';

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
}
