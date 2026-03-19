import { Injectable, Logger } from '@nestjs/common';
import { MembershipsRepository } from '@libs/memberships';
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
 * of database-driven Role/Permission tables. Only the Membership row is fetched
 * per request via MembershipsRepository.
 */
@Injectable()
export class RBACService {
  private readonly logger = new Logger(RBACService.name);

  constructor(private readonly membershipsRepo: MembershipsRepository) {}

  getPermissionsForRole(role: MembershipRole): string[] {
    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions) {
      this.logger.warn(`No permissions defined for role: ${role}`);
      return [];
    }
    return permissions;
  }

  async resolveContext(
    userId: string,
    orgId: string,
  ): Promise<RBACContextData | null> {
    const membership = await this.membershipsRepo.findByUserAndOrg(
      userId,
      orgId,
    );
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
    const membership = await this.membershipsRepo.findByUserAndOrg(
      userId,
      orgId,
    );
    if (!membership || membership.status !== MembershipStatus.ACTIVE)
      return false;
    return roles.includes(membership.role);
  }
}
