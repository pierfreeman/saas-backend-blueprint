import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus, User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Syncs an Auth0 user to the local database.
   *
   * - **New user:** runs a single DB transaction that creates the User record,
   *   a personal Organization ("Personal Workspace"), and an OWNER Membership.
   *   The organization starts with billingStatus=NONE (FREE tier entitlements).
   * - **Returning user, same email:** returns the cached record unchanged.
   * - **Returning user, changed email:** updates the email field only.
   */
  async syncUser(auth0Id: string, email: string): Promise<User> {
    const existingUser = await this.prisma.user.findUnique({
      where: { auth0Id },
    });

    if (!existingUser) {
      this.logger.log(
        `First login for Auth0 ID: ${auth0Id} — provisioning user + org`,
      );

      const { user } = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: { auth0Id, email },
        });

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

      this.logger.log(`Provisioned user ${user.id} with personal org`);
      return user;
    }

    if (existingUser.email !== email) {
      this.logger.log(`Updating email for user ${existingUser.id}`);
      return this.prisma.user.update({
        where: { id: existingUser.id },
        data: { email },
      });
    }

    return existingUser;
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { auth0Id } });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
