import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RequestUser } from '@libs/common';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get the currently authenticated user',
    description: 'Returns the profile of the currently authenticated user.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Returns the authenticated user profile',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async getMe(@CurrentUser() user: RequestUser): Promise<{
    id: string;
    sub: string;
    email: string;
    // organization: {
    //   id: string;
    //   name: string;
    //   plan: string;
    //   status: string;
    // } | null;
  }> {
    const dbUser = await this.authService.syncUser(user.sub, user.email);
    return {
      id: dbUser.id,
      sub: user.sub,
      email: user.email,
      // organization: userWithOrg?.memberships?.[0]?.organization
      //   ? {
      //       id: userWithOrg.memberships[0].organization.id,
      //       name: userWithOrg.memberships[0].organization.name,
      //       plan:
      //         userWithOrg.memberships[0].organization.subscription?.plan ||
      //         'FREE',
      //       status: userWithOrg.memberships[0].organization.status,
      //     }
      //   : null,
    };
  }
}
