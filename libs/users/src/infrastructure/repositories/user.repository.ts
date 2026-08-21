import {
  MembershipRole,
  MembershipStatus,
  Organization,
  PrismaBusinessService,
  User,
} from '@libs/prisma-business';
import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async findByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { auth0Id } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async updateEmail(id: string, email: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { email } });
  }

  async updateAuth0Id(id: string, auth0Id: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { auth0Id } });
  }

  async updateProfile(
    id: string,
    data: { firstName?: string; lastName?: string; pictureUrl?: string },
  ): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  /**
   * Creates a bare user record without provisioning an org.
   * Used only as an emergency fallback in infrastructure guards when
   * the normal Auth0 login sync path was somehow bypassed.
   */
  async createUser(auth0Id: string, email: string): Promise<User> {
    return this.prisma.user.create({ data: { auth0Id, email } });
  }

  /**
   * Provisions a new user with a personal workspace org and OWNER membership
   * atomically in a single transaction. Called on first Auth0 login.
   *
   * Bypasses PrismaBusinessService's per-delegate RLS proxy on purpose,
   * same reasoning as OrganizationsRepository#createWithOwner: this
   * transaction spans `users`, `organizations`, and `memberships` INSERTs,
   * and no tenant context can exist yet for an org that doesn't exist yet.
   * The org id is generated client-side so app.current_org_id can be set
   * before either org-scoped INSERT runs (required by their RLS
   * WITH CHECK clauses). `users` itself is not tenant-scoped (no RLS
   * policy), so its INSERT is unaffected by the session var either way.
   */
  async provisionWithPersonalOrg(
    auth0Id: string,
    email: string,
  ): Promise<{ user: User; organization: Organization }> {
    const orgId = uuidv4();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      const user = await tx.user.create({ data: { auth0Id, email } });
      const organization = await tx.organization.create({
        data: { id: orgId, name: 'Personal Workspace' },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          orgId: organization.id,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });
      return { user, organization };
    });
  }

  /**
   * Permanently deletes a user record from the database.
   * Memberships are cascade-deleted by the database constraint.
   */
  async deleteUser(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
