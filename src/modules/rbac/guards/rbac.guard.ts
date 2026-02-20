import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, PermissionsMetadata } from '../decorators/require-permissions.decorator';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { RequestWithOrgContext } from './org-context.guard';

/**
 * RBACGuard - Enforces permission and role-based access control
 *
 * This guard:
 * 1. Checks @RequirePermissions() decorator metadata
 * 2. Checks @RequireRole() decorator metadata
 * 3. Resolves user permissions (with Redis caching)
 * 4. Validates access based on permissions OR roles
 * 5. Injects resolved permissions into request
 *
 * Prerequisites:
 * - JwtAuthGuard must run first (provides user)
 * - OrgContextGuard must run first (provides orgId and dbUserId)
 *
 * Usage:
 * ```typescript
 * @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
 * @RequirePermissions([PERMISSIONS.TEAM_CREATE])
 * async createTeam() { ... }
 * ```
 */
@Injectable()
export class RBACGuard implements CanActivate {
  private readonly logger = new Logger(RBACGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get metadata from decorators
    const permissionsMetadata = this.reflector.getAllAndOverride<PermissionsMetadata>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(REQUIRE_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No RBAC requirements = allow
    if (!permissionsMetadata && !requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const userId = request.user?.dbUserId;
    const orgId = request.orgId;
    const membership = request.membership;

    if (!userId) {
      throw new ForbiddenException('User context not found');
    }

    if (!orgId) {
      throw new ForbiddenException('Organization context not found');
    }

    if (!membership) {
      throw new ForbiddenException('Membership not found');
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException('Membership is not active');
    }

    // Check role-based access first (faster)
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(membership.role as MembershipRole);
      if (hasRole) {
        this.logger.debug(
          `User ${userId} granted access by role: ${membership.role} in ${requiredRoles.join(', ')}`,
        );
        return true;
      }
    }

    // Check permission-based access
    if (permissionsMetadata) {
      const { permissions, mode } = permissionsMetadata;

      // Resolve user permissions (cached)
      const userPermissions = await this.permissionResolver.resolvePermissions(userId, orgId);

      // Inject into request for downstream use
      request['rbacPermissions'] = userPermissions;
      request['rbacRole'] = membership.role;

      let hasAccess = false;

      if (mode === 'ALL') {
        hasAccess = permissions.every((perm) => userPermissions.includes(perm));
      } else {
        // mode === 'ANY'
        hasAccess = permissions.some((perm) => userPermissions.includes(perm));
      }

      if (!hasAccess) {
        this.logger.warn(
          `User ${userId} denied: required permissions [${permissions.join(', ')}] (${mode}), has [${userPermissions.join(', ')}]`,
        );
        throw new ForbiddenException('You do not have permission to perform this action');
      }

      this.logger.debug(`User ${userId} granted access by permissions: ${permissions.join(', ')}`);
      return true;
    }

    // If only roles were specified and none matched
    if (requiredRoles && requiredRoles.length > 0) {
      this.logger.warn(
        `User ${userId} denied: required roles [${requiredRoles.join(', ')}], has [${membership.role}]`,
      );
      throw new ForbiddenException('You do not have the required role to perform this action');
    }

    return true;
  }
}
