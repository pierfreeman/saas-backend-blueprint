import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@libs/users';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * Syncs an Auth0 user to the local database.
   *
   * - **New user:** provisions user + personal org in one transaction via UserRepository.
   * - **Returning user, same email:** returns cached record unchanged.
   * - **Returning user, changed email:** updates email only.
   */
  async syncUser(auth0Id: string, email: string): Promise<User> {
    const existingUser = await this.usersService.findByAuth0Id(auth0Id);

    if (!existingUser) {
      this.logger.log(
        `First login for Auth0 ID: ${auth0Id} — provisioning user + org`,
      );
      const user = await this.usersService.provisionWithPersonalOrg(
        auth0Id,
        email,
      );
      this.logger.log(`Provisioned user ${user.id} with personal org`);
      return user;
    }

    if (existingUser.email !== email) {
      this.logger.log(`Updating email for user ${existingUser.id}`);
      return this.usersService.updateEmail(existingUser.id, email);
    }

    return existingUser;
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.usersService.findByAuth0Id(auth0Id);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersService.findById(id);
  }
}
