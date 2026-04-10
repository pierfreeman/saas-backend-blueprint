import { AdminJwtAuthGuard, CurrentAdminUserId } from '@libs/admin/auth';
import { AdminIdentityService, AdminUserProfile } from '@libs/admin/identity';
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminJwtAuthGuard)
@Controller('admin')
export class AdminMeController {
  constructor(private readonly adminIdentityService: AdminIdentityService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the currently authenticated admin user' })
  @ApiResponse({
    status: 200,
    description: 'Current admin user profile.',
  })
  getMe(@CurrentAdminUserId() adminUserId: string): Promise<AdminUserProfile> {
    return this.adminIdentityService.findByIdOrThrow(adminUserId);
  }
}
