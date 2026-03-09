import { JwtAuthGuard, RequestUser } from '@libs/common';
import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';

@ApiTags('Authentication')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Get the currently authenticated user',
    description:
      'Syncs the Auth0 identity with the local database (upsert) and returns ' +
      'the resolved user profile. Safe to call on every app load.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Authenticated user profile.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          description: 'Internal database UUID of the user.',
          example: 'c7b3e1a2-45d6-4f89-9012-3456789abcde',
        },
        auth0Id: {
          type: 'string',
          description: 'Auth0 subject identifier ("sub" JWT claim).',
          example: 'auth0|64a1b2c3d4e5f6a7b8c9d0e1',
        },
        email: {
          type: 'string',
          format: 'email',
          description: 'Email address from the Auth0 token.',
          example: 'alice@example.com',
        },
      },
      required: ['id', 'auth0Id', 'email'],
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  async getMe(@CurrentUser() user: RequestUser): Promise<{
    id: string;
    auth0Id: string;
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
      auth0Id: user.sub,
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
