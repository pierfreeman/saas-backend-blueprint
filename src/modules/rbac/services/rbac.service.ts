import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PermissionKey } from '../constants/permissions.constants';

export interface RBACContext {
  userId: string;
  orgId: string;
  role: MembershipRole;
  status: MembershipStatus;
  permissions: string[];
}

@Injectable()
export class RBACService implements OnModuleInit {
  private readonly logger = new Logger(RBACService.name);

  // In-memory cache for role-permission mappings
  private rolePermissionsCache: Map<string, string[]> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadRolePermissions();
  }

  /**
   * Load all role-permission mappings into memory
   */
  private async loadRolePermissions(): Promise<void> {
    this.logger.log('Loading role-permission mappings...');

    const roles = await this.prisma.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    for (const role of roles) {
      const permissions = role.permissions.map((rp) => rp.permission.key);
      this.rolePermissionsCache.set(role.name, permissions);
      this.logger.debug(`Loaded ${permissions.length} permissions for role ${role.name}`);
    }

    this.logger.log(`Loaded ${roles.length} roles with permissions`);
  }

  /**
   * Get permissions for a specific role
   */
  getPermissionsForRole(role: MembershipRole): string[] {
    const permissions = this.rolePermissionsCache.get(role);
    if (!permissions) {
      this.logger.warn(`No permissions found for role: ${role}`);
      return [];
    }
    return permissions;
  }

  /**
   * Resolve RBAC context for a user in an organization
   */
  async resolveContext(userId: string, orgId: string): Promise<RBACContext | null> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_orgId: { userId, orgId },
      },
    });

    if (!membership) {
      return null;
    }

    const permissions = this.getPermissionsForRole(membership.role);

    return {
      userId,
      orgId,
      role: membership.role,
      status: membership.status,
      permissions,
    };
  }

  /**
   * Check if user has specific permission
   */
  async hasPermission(
    userId: string,
    orgId: string,
    permission: PermissionKey | string,
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);

    if (!context) {
      return false;
    }

    // Must be active member
    if (context.status !== MembershipStatus.ACTIVE) {
      return false;
    }

    return context.permissions.includes(permission);
  }

  /**
   * Check if user has any of the specified permissions
   */
  async hasAnyPermission(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | string)[],
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);

    if (!context) {
      return false;
    }

    // Must be active member
    if (context.status !== MembershipStatus.ACTIVE) {
      return false;
    }

    return permissions.some((perm) => context.permissions.includes(perm));
  }

  /**
   * Check if user has all specified permissions
   */
  async hasAllPermissions(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | string)[],
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);

    if (!context) {
      return false;
    }

    // Must be active member
    if (context.status !== MembershipStatus.ACTIVE) {
      return false;
    }

    return permissions.every((perm) => context.permissions.includes(perm));
  }

  /**
   * Check if user has specific role
   */
  async hasRole(userId: string, orgId: string, roles: MembershipRole[]): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_orgId: { userId, orgId },
      },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      return false;
    }

    return roles.includes(membership.role);
  }

  /**
   * Refresh role permissions cache (call when permissions change)
   */
  async refreshPermissionsCache(): Promise<void> {
    this.logger.log('Refreshing role permissions cache...');
    this.rolePermissionsCache.clear();
    await this.loadRolePermissions();
  }

  /**
   * Get all permissions with metadata
   */
  async getAllPermissions() {
    return this.prisma.permission.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  /**
   * Get all roles with their permissions
   */
  async getAllRoles() {
    return this.prisma.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
}
