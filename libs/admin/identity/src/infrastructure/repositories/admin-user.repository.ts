import { Injectable } from '@nestjs/common';
import { type AdminUser, PrismaLegalService } from '@libs/prisma-legal';

export type { AdminUser };

/**
 * AdminUserRepository
 *
 * Single-aggregate repository for the AdminUser model in the legal audit DB.
 * Never export this class — use AdminIdentityService for all external access.
 */
@Injectable()
export class AdminUserRepository {
  constructor(private readonly prisma: PrismaLegalService) {}

  /**
   * Upsert an admin user record by Auth0 subject.
   * Called on every successful JWT validation so the record stays current.
   */
  async upsertByAuth0Id(
    auth0Id: string,
    email: string,
    displayName?: string,
  ): Promise<AdminUser> {
    return this.prisma.adminUser.upsert({
      where: { auth0Id },
      create: { auth0Id, email, displayName },
      update: { email, displayName },
    });
  }

  async findByAuth0Id(auth0Id: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { auth0Id } });
  }

  async findById(id: string): Promise<AdminUser | null> {
    return this.prisma.adminUser.findUnique({ where: { id } });
  }

  async findAll(): Promise<AdminUser[]> {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }
}
