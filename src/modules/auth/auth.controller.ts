import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RequestUser } from './interfaces/request-user.interface';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: RequestUser): Promise<{
    id: string;
    sub: string;
    email: string;
    organization: {
      id: string;
      name: string;
      plan: string;
      status: string;
    } | null;
  }> {
    // Sync user with database (create if not exists)
    const dbUser = await this.authService.syncUser(user.sub, user.email);

    // Get user with their primary organization
    const userWithOrg = await this.authService.getUserWithOrganization(dbUser.id);

    return {
      id: dbUser.id,
      sub: user.sub,
      email: user.email,
      organization: userWithOrg?.memberships?.[0]?.organization
        ? {
            id: userWithOrg.memberships[0].organization.id,
            name: userWithOrg.memberships[0].organization.name,
            plan: userWithOrg.memberships[0].organization.subscription?.plan || 'FREE',
            status: userWithOrg.memberships[0].organization.status,
          }
        : null,
    };
  }
}
