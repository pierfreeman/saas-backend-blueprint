import { Injectable } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus, User } from '@libs/prisma-business';

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
   */
  async provisionWithPersonalOrg(
    auth0Id: string,
    email: string,
  ): Promise<User> {
    const { user } = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({ data: { auth0Id, email } });
      const org = await tx.organization.create({
        data: { name: 'Personal Workspace' },
      });
      await tx.membership.create({
        data: {
          userId: newUser.id,
          orgId: org.id,
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });
      return { user: newUser, org };
    });
    return user;
  }

  /**
   * Permanently deletes a user record from the database.
   * Memberships are cascade-deleted by the database constraint.
   */
  async deleteUser(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
  }
}
