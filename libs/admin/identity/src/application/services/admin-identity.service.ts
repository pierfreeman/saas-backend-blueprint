import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AdminUserRepository } from '../../infrastructure/repositories/admin-user.repository';

export type { AdminUser } from '../../infrastructure/repositories/admin-user.repository';

export interface AdminUserProfile {
  adminUserId: string;
  auth0Id: string;
  email: string;
  displayName: string | null;
}

/**
 * AdminIdentityService
 *
 * Public API of the admin-identity library.
 * Orchestrates the AdminUserRepository to sync and resolve admin identities.
 *
 * Called by AdminJwtStrategy on every authenticated request to:
 * 1. Upsert the admin user record (keeps email/displayName current).
 * 2. Return the internal adminUserId to be attached to the request.
 */
@Injectable()
export class AdminIdentityService {
  private readonly logger = new Logger(AdminIdentityService.name);

  constructor(private readonly adminUserRepository: AdminUserRepository) {}

  /**
   * Synchronise an admin user from a validated JWT payload.
   * Upserts on first login; updates email/display name on subsequent calls.
   *
   * @returns AdminUserProfile with the internal UUID and decoded fields.
   */
  async syncAdminUser(
    auth0Id: string,
    email: string,
    displayName?: string,
  ): Promise<AdminUserProfile> {
    const adminUser = await this.adminUserRepository.upsertByAuth0Id(
      auth0Id,
      email,
      displayName,
    );

    this.logger.debug(`Admin user synced: id=${adminUser.id}`);

    return this.toProfile(adminUser);
  }

  /**
   * Look up an admin user by their internal UUID.
   * Throws UnauthorizedException if the record no longer exists.
   */
  async findByIdOrThrow(adminUserId: string): Promise<AdminUserProfile> {
    const adminUser = await this.adminUserRepository.findById(adminUserId);

    if (!adminUser) {
      throw new UnauthorizedException('Admin user not found');
    }

    return this.toProfile(adminUser);
  }

  async findAll(): Promise<AdminUserProfile[]> {
    const users = await this.adminUserRepository.findAll();
    return users.map((u) => this.toProfile(u));
  }

  private toProfile(user: AdminUser): AdminUserProfile {
    return {
      adminUserId: user.id,
      auth0Id: user.auth0Id,
      email: user.email,
      displayName: user.displayName,
    };
  }
}
