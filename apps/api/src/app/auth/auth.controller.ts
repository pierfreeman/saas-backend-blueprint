import { JwtAuthGuard, RequestUser } from '@libs/common';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from '@libs/auth0';
import { CurrentUser } from './current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
        firstName: {
          type: 'string',
          nullable: true,
          description:
            'Given name. Synced from Auth0 on first social login; editable via PATCH /auth/me.',
          example: 'Alice',
        },
        lastName: {
          type: 'string',
          nullable: true,
          description:
            'Family name. Synced from Auth0 on first social login; editable via PATCH /auth/me.',
          example: 'Smith',
        },
        pictureUrl: {
          type: 'string',
          nullable: true,
          description:
            'Profile picture URL. Synced from Auth0 on first social login; editable via PATCH /auth/me.',
          example: 'https://lh3.googleusercontent.com/a/example',
        },
        isSystemAdmin: {
          type: 'boolean',
          description:
            'Whether this user has system-admin access to the backoffice portal.',
          example: false,
        },
      },
      required: ['id', 'auth0Id', 'email', 'isSystemAdmin'],
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
    firstName: string | null;
    lastName: string | null;
    pictureUrl: string | null;
    isSystemAdmin: boolean;
  }> {
    const dbUser = await this.authService.syncUser(user.sub, user.email);
    return {
      id: dbUser.id,
      auth0Id: user.sub,
      email: dbUser.email,
      firstName: dbUser.firstName ?? null,
      lastName: dbUser.lastName ?? null,
      pictureUrl: dbUser.pictureUrl ?? null,
      isSystemAdmin: dbUser.isSystemAdmin,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @ApiOperation({
    summary: 'Update the current user profile',
    description:
      'Allows the authenticated user to update their first name, last name, and profile picture URL. ' +
      'All fields are optional; only provided fields are updated.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated user profile.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        firstName: { type: 'string', nullable: true },
        lastName: { type: 'string', nullable: true },
        pictureUrl: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async updateMe(
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateProfileDto,
  ): Promise<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    pictureUrl: string | null;
  }> {
    const dbUser = await this.authService.syncUser(user.sub, user.email);
    const updated = await this.authService.updateProfile(dbUser.id, {
      firstName: body.firstName,
      lastName: body.lastName,
      pictureUrl: body.pictureUrl,
    });
    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName ?? null,
      lastName: updated.lastName ?? null,
      pictureUrl: updated.pictureUrl ?? null,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Request a password reset email',
    description:
      'Triggers an Auth0 password reset email for the current user. ' +
      'Only available for email/password accounts (auth0| prefix). ' +
      'Google and passwordless accounts are not supported.',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Password reset email sent successfully.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Password reset is not available for this account type.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async requestPasswordChange(@CurrentUser() user: RequestUser): Promise<void> {
    if (!user.sub.startsWith('auth0|')) {
      throw new BadRequestException(
        'Password reset is only available for email/password accounts.',
      );
    }
    const dbUser = await this.authService.syncUser(user.sub, user.email);
    await this.authService.requestPasswordChange(dbUser.email);
  }
}
