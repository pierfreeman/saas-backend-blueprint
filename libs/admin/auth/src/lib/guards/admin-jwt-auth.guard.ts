import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * AdminJwtAuthGuard
 *
 * Drop-in replacement for the `JwtAuthGuard + SystemAdminGuard` pipeline
 * on admin-api controllers.
 *
 * Uses the 'admin-jwt' Passport strategy (AdminJwtStrategy) which:
 * 1. Validates the RS256 JWT against the Admin-Users-DB JWKS endpoint.
 * 2. Syncs the AdminUser record in the legal DB.
 * 3. Attaches { sub, email, adminUserId } to request.user.
 *
 * Usage:
 * ```ts
 * @UseGuards(AdminJwtAuthGuard)
 * @Controller('admin/organizations')
 * export class AdminOrganizationsController {}
 * ```
 */
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard('admin-jwt') {}
