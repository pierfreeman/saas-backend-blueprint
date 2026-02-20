import { Injectable, Logger } from '@nestjs/common';
import { RBACService } from './rbac.service';
import { RBACCacheService } from './rbac-cache.service';
import { MembershipRole } from '@prisma/client';
import { PermissionKey } from '../constants/permissions.constants';

@Injectable()
export class PermissionResolverService {
  private readonly logger = new Logger(PermissionResolverService.name);

  constructor(
    private readonly rbacService: RBACService,
    private readonly rbacCache: RBACCacheService,
  ) {}

  /**
   * Resolve user permissions with caching
   */
  async resolvePermissions(userId: string, orgId: string): Promise<string[]> {
    // Try cache first
    const cached = await this.rbacCache.get(userId, orgId);
    if (cached) {
      this.logger.debug(`RBAC cache HIT for user ${userId} in org ${orgId}`);
      return cached.permissions;
    }

    this.logger.debug(`RBAC cache MISS for user ${userId} in org ${orgId}`);

    // Resolve from database
    const context = await this.rbacService.resolveContext(userId, orgId);

    if (!context) {
      return [];
    }

    // Cache for future requests
    await this.rbacCache.set(context);

    return context.permissions;
  }

  /**
   * Check permission with caching
   */
  async hasPermission(
    userId: string,
    orgId: string,
    permission: PermissionKey | string,
  ): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId, orgId);
    return permissions.includes(permission);
  }

  /**
   * Check if user has any of the permissions
   */
  async hasAnyPermission(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | string)[],
  ): Promise<boolean> {
    const userPermissions = await this.resolvePermissions(userId, orgId);
    return permissions.some((perm) => userPermissions.includes(perm));
  }

  /**
   * Check if user has all permissions
   */
  async hasAllPermissions(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | string)[],
  ): Promise<boolean> {
    const userPermissions = await this.resolvePermissions(userId, orgId);
    return permissions.every((perm) => userPermissions.includes(perm));
  }

  /**
   * Get user role with caching
   */
  async getUserRole(userId: string, orgId: string): Promise<MembershipRole | null> {
    const cached = await this.rbacCache.get(userId, orgId);
    if (cached) {
      return cached.role;
    }

    const context = await this.rbacService.resolveContext(userId, orgId);
    if (context) {
      await this.rbacCache.set(context);
      return context.role;
    }

    return null;
  }
}
