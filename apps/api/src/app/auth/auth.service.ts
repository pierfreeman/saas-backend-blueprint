import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@libs/users';
import { User } from '@prisma/client';

/** Prefix used for Prisma users created by the invite flow before the
 *  invitee has logged in and obtained a real Auth0 subject claim. */
export const PENDING_AUTH0_ID_PREFIX = 'pending:';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * Syncs an Auth0 user to the local database.
   *
   * - **New user:** provisions user + personal org in one transaction via UserRepository.
   * - **Invited-pending user:** the invite flow pre-creates a Prisma record with a
   *   `pending:<uuid>` placeholder auth0Id. On first login we detect this by email
   *   and replace the placeholder with the real Auth0 subject claim ("accounting link").
   * - **Returning user, same email:** returns cached record unchanged.
   * - **Returning user, changed email:** updates email only.
   * - **Auth0 account linking fallback:** if the Auth0 post-login Action fails silently,
   *   the JWT `sub` may differ from the stored auth0Id for the same email. We detect
   *   this by email lookup and overwrite the stored auth0Id with the current JWT sub,
   *   keeping one Prisma record per user and avoiding a unique-constraint error on email.
   *   Safe because both passwordless and Google login always produce verified emails.
   */
  async syncUser(auth0Id: string, email: string): Promise<User> {
    // Normalize email to lowercase for consistent lookup regardless of how Auth0
    // or the invite form submitted the address.
    const normalizedEmail = email.toLowerCase();

    const existingUser = await this.usersService.findByAuth0Id(auth0Id);

    if (existingUser) {
      if (existingUser.email !== normalizedEmail) {
        this.logger.log(`Updating email for user ${existingUser.id}`);
        return this.usersService.updateEmail(existingUser.id, normalizedEmail);
      }
      return existingUser;
    }

    // No user found by auth0Id -- check by email.
    // This handles two cases:
    //   a) Invited-pending user: auth0Id starts with `pending:` placeholder.
    //   b) Auth0 account linking failure: a verified user exists with this email
    //      but a different auth0Id (e.g. OTP account not yet linked to Google).
    // In both cases we update the stored auth0Id to the current JWT sub, keeping
    // a single Prisma record and all memberships intact.
    const userByEmail = await this.usersService.findByEmail(normalizedEmail);
    if (userByEmail) {
      if (userByEmail.auth0Id.startsWith(PENDING_AUTH0_ID_PREFIX)) {
        this.logger.log(
          `Linking invited pending user ${normalizedEmail} to real Auth0 ID ${auth0Id}`,
        );
      } else {
        this.logger.warn(
          `Auth0 account linking fallback: relinking ${normalizedEmail} ` +
            `from ${userByEmail.auth0Id} to ${auth0Id}`,
        );
      }
      return this.usersService.updateAuth0Id(userByEmail.id, auth0Id);
    }

    this.logger.log(
      `First login for Auth0 ID: ${auth0Id} -- provisioning user + org`,
    );
    const user = await this.usersService.provisionWithPersonalOrg(
      auth0Id,
      normalizedEmail,
    );
    this.logger.log(`Provisioned user ${user.id} with personal org`);
    return user;
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.usersService.findByAuth0Id(auth0Id);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersService.findById(id);
  }
}
