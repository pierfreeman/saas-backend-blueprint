import { Injectable, Logger } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { RBACService } from './rbac.service';
import { RBACCacheService } from './rbac-cache.service';
import { PermissionKey } from '@libs/common';

/**
 * PermissionResolverService
 *
 * Thin facade combining RBACService + RBACCacheService.
 * All guards and service consumers should use this instead of
 * calling RBACService directly, so caching is always applied.
 */
@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);

  constructor(
    private readonly rbacService: RBACService,
    private readonly rbacCache: RBACCacheService,
  ) {}

  async resolvePermissions(userId: string, orgId: string): Promise<string[]> {
    const cached = await this.rbacCache.get(userId, orgId);
    if (cached) {
      this.logger.debug(`RBAC cache HIT for user ${userId} in org ${orgId}`);
      return cached.permissions;
    }

    this.logger.debug(`RBAC cache MISS for user ${userId} in org ${orgId}`);
    const context = await this.rbacService.resolveContext(userId, orgId);
    if (!context) return [];

    await this.rbacCache.set(context);
    return context.permissions;
  }

  async hasPermission(
    userId: string,
    orgId: string,
    permission: PermissionKey | (string & {}),
  ): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId, orgId);
    return permissions.includes(permission);
  }

  async hasAnyPermission(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | (string & {}))[],
  ): Promise<boolean> {
    const userPermissions = await this.resolvePermissions(userId, orgId);
    return permissions.some((p) => userPermissions.includes(p));
  }

  async hasAllPermissions(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | (string & {}))[],
  ): Promise<boolean> {
    const userPermissions = await this.resolvePermissions(userId, orgId);
    return permissions.every((p) => userPermissions.includes(p));
  }

  async getUserRole(
    userId: string,
    orgId: string,
  ): Promise<MembershipRole | null> {
    const cached = await this.rbacCache.get(userId, orgId);
    if (cached) return cached.role;

    const context = await this.rbacService.resolveContext(userId, orgId);
    if (context) {
      await this.rbacCache.set(context);
      return context.role;
    }
    return null;
  }
}
