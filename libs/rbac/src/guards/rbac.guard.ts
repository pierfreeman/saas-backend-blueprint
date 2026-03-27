import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import {
  PERMISSIONS_KEY,
  PermissionsMetadata,
} from '../decorators/require-permissions.decorator';
import { REQUIRE_ROLE_KEY } from '../decorators/require-role.decorator';
import { PermissionResolverService } from '../services/permission-resolver.service';
import { RequestWithOrgContext } from './org-context.guard';

/**
 * RBACGuard
 *
 * Pipeline position: after JwtAuthGuard + OrgContextGuard.
 *
 * Enforces access control using:
 * - `@RequireRole(...)` — role shortcut (fast, no Redis lookup)
 * - `@RequirePermissions([...])` — fine-grained permission check (cached via Redis)
 *
 * If neither decorator is present, the guard passes through.
 *
 * @example
 * ```typescript
 * @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
 * @RequirePermissions([PERMISSIONS.ORG_MANAGE])
 * async updateOrg() { ... }
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
    const permissionsMetadata =
      this.reflector.getAllAndOverride<PermissionsMetadata>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(
      REQUIRE_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No RBAC requirements — allow
    if (!permissionsMetadata && !requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const userId = request.user?.dbUserId;
    const orgId = request.orgId;
    const membership = request.membership;

    if (!userId) throw new ForbiddenException('User context not found');
    if (!orgId) throw new ForbiddenException('Organization context not found');
    if (!membership) throw new ForbiddenException('Membership not found');

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException('Membership is not active');
    }

    // Role check (fast path — no Redis)
    if (requiredRoles?.length) {
      const hasRole = requiredRoles.includes(membership.role as MembershipRole);
      if (hasRole) {
        this.logger.debug(`Access granted by role: ${membership.role}`);
        return true;
      }
    }

    // Permission check (cached)
    if (permissionsMetadata) {
      return this.checkPermissions(
        request,
        userId,
        orgId,
        membership.role,
        permissionsMetadata,
      );
    }

    // Roles specified but none matched
    if (requiredRoles?.length) {
      this.logger.warn(
        `User ${userId} denied: required roles [${requiredRoles.join(', ')}], has [${membership.role}]`,
      );
      throw new ForbiddenException('You do not have the required role');
    }

    return true;
  }

  private async checkPermissions(
    request: RequestWithOrgContext,
    userId: string,
    orgId: string,
    role: string,
    permissionsMetadata: PermissionsMetadata,
  ): Promise<boolean> {
    const { permissions, mode } = permissionsMetadata;
    const userPermissions = await this.permissionResolver.resolvePermissions(
      userId,
      orgId,
    );

    // Inject into request for downstream use (e.g. audit logging)
    request.rbacPermissions = userPermissions;
    request.rbacRole = role;

    // Keep tenantContext in sync
    if (request.tenantContext) {
      request.tenantContext.permissions = userPermissions;
      request.tenantContext.role = role;
    }

    const hasAccess =
      mode === 'ALL'
        ? permissions.every((p) => userPermissions.includes(p))
        : permissions.some((p) => userPermissions.includes(p));

    if (!hasAccess) {
      this.logger.warn(
        `User ${userId} denied: required [${permissions.join(', ')}] (${mode}), has [${userPermissions.join(', ')}]`,
      );
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }

    this.logger.debug(
      `Access granted by permissions: ${permissions.join(', ')}`,
    );
    return true;
  }
}
