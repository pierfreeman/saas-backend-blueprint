import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from '@libs/users';
import { RequestUser } from '@libs/common';

export interface AdminRequest extends Request {
  user: RequestUser & { dbUserId?: string };
}

/**
 * SystemAdminGuard
 *
 * Pipeline position: immediately after JwtAuthGuard.
 * OrgContextGuard and RBACGuard are NOT part of the admin pipeline —
 * system-admin operations are cross-tenant by design.
 *
 * What this guard does:
 * 1. Reads `request.user.sub` (Auth0 subject) set by JwtAuthGuard.
 * 2. Resolves the DB user by auth0Id.
 * 3. Checks `user.isSystemAdmin === true`.
 * 4. On success injects `request.user.dbUserId` for use in controllers / decorators.
 *
 * Usage:
 * ```ts
 * @UseGuards(JwtAuthGuard, SystemAdminGuard)
 * @Controller('admin')
 * export class AdminOrganizationsController {}
 * ```
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  private readonly logger = new Logger(SystemAdminGuard.name);

  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const jwtUser = request.user;

    if (!jwtUser?.sub) {
      throw new UnauthorizedException('Authentication required');
    }

    const dbUser = await this.usersService.findByAuth0Id(jwtUser.sub);

    if (!dbUser) {
      this.logger.warn(
        `SystemAdminGuard: no DB user found for auth0Id=${jwtUser.sub}`,
      );
      throw new ForbiddenException('Access denied');
    }

    if (!dbUser.isSystemAdmin) {
      this.logger.warn(
        `SystemAdminGuard: access denied for user=${dbUser.id} (isSystemAdmin=false)`,
      );
      throw new ForbiddenException('Access denied');
    }

    // Inject dbUserId so admin controllers can use @CurrentAdminUserId().
    request.user.dbUserId = dbUser.id;

    return true;
  }
}
