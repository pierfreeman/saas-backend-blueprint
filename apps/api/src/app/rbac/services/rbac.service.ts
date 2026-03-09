import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PermissionKey, ROLE_PERMISSIONS } from '@libs/common';

export interface RBACContextData {
  userId: string;
  orgId: string;
  role: MembershipRole;
  status: MembershipStatus;
  permissions: string[];
}

/**
 * RBACService
 *
 * Resolves role → permissions using a **static map** (ROLE_PERMISSIONS) instead
 * of database-driven Role/Permission tables. This keeps queries minimal —
 * only the Membership row is fetched per request.
 *
 * To change what each role can do, edit `constants/roles.constants.ts`.
 */
@Injectable()
export class RBACService {
  private readonly logger = new Logger(RBACService.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Returns the permissions for a given role from the static map.
   */
  getPermissionsForRole(role: MembershipRole): string[] {
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) {
      this.logger.warn(`No permissions defined for role: ${role}`);
      return [];
    }
    return permissions;
  }

  /**
   * Resolves the full RBAC context for a user in an organization.
   * Returns null if no membership found.
   */
  async resolveContext(
    userId: string,
    orgId: string,
  ): Promise<RBACContextData | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!membership) return null;

    return {
      userId,
      orgId,
      role: membership.role,
      status: membership.status,
      permissions: this.getPermissionsForRole(membership.role),
    };
  }

  async hasPermission(
    userId: string,
    orgId: string,
    permission: PermissionKey | (string & {}),
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);
    if (!context || context.status !== MembershipStatus.ACTIVE) return false;
    return context.permissions.includes(permission);
  }

  async hasAnyPermission(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | (string & {}))[],
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);
    if (!context || context.status !== MembershipStatus.ACTIVE) return false;
    return permissions.some((p) => context.permissions.includes(p));
  }

  async hasAllPermissions(
    userId: string,
    orgId: string,
    permissions: (PermissionKey | (string & {}))[],
  ): Promise<boolean> {
    const context = await this.resolveContext(userId, orgId);
    if (!context || context.status !== MembershipStatus.ACTIVE) return false;
    return permissions.every((p) => context.permissions.includes(p));
  }

  async hasRole(
    userId: string,
    orgId: string,
    roles: MembershipRole[],
  ): Promise<boolean> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE)
      return false;
    return roles.includes(membership.role);
  }
}
