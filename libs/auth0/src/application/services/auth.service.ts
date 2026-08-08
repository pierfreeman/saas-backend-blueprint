import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@libs/users';
import { EmailService } from '@libs/email';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { MembershipsService } from '@libs/memberships';
import { User, runWithTenant } from '@libs/prisma-business';
import { IIdentityProvider } from '../../domain/ports/identity-provider.interface';
import { PENDING_USER_PREFIX } from '../../constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly identityProvider: IIdentityProvider,
    private readonly emailService: EmailService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    private readonly membershipsService: MembershipsService,
  ) {}

  /**
   * Syncs an identity-provider user to the local database.
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
  async syncUser(
    auth0Id: string,
    email: string,
    profile?: { firstName?: string; lastName?: string; pictureUrl?: string },
  ): Promise<User> {
    const normalizedEmail = email.toLowerCase();

    const existingUser = await this.usersService.findByAuth0Id(auth0Id);
    if (existingUser) {
      return this.handleExistingUser(existingUser, normalizedEmail);
    }

    const resolvedEmail = await this.resolveEmail(auth0Id, normalizedEmail);
    const userByEmail = await this.usersService.findByEmail(resolvedEmail);
    if (userByEmail) {
      return this.relinkExistingUser(userByEmail, auth0Id, resolvedEmail);
    }

    return this.provisionNewUser(auth0Id, resolvedEmail, profile);
  }

  private async handleExistingUser(
    existingUser: User,
    normalizedEmail: string,
  ): Promise<User> {
    if (
      existingUser.email !== normalizedEmail &&
      !normalizedEmail.endsWith('@auth0.placeholder')
    ) {
      this.logger.log(`Updating email for user ${existingUser.id}`);
      const updated = await this.usersService.updateEmail(
        existingUser.id,
        normalizedEmail,
      );

      this.legalAudit.recordEvent({
        eventType: 'user.email.updated',
        userId: existingUser.id,
        triggerType: 'system',
        metadata: { previousEmail: existingUser.email },
      });

      return updated;
    }
    return existingUser;
  }

  private async resolveEmail(
    auth0Id: string,
    normalizedEmail: string,
  ): Promise<string> {
    if (!normalizedEmail.endsWith('@auth0.placeholder')) {
      return normalizedEmail;
    }

    try {
      const identityUser = await this.identityProvider.getUserById(auth0Id);
      const resolvedEmail = identityUser.email.toLowerCase();
      this.logger.log(
        `Resolved real email from identity provider for ${auth0Id}: ${resolvedEmail}`,
      );
      return resolvedEmail;
    } catch (err) {
      this.logger.warn(
        `Could not resolve email for ${auth0Id} from identity provider — keeping placeholder`,
        err instanceof Error ? err.message : err,
      );
      return normalizedEmail;
    }
  }

  private async relinkExistingUser(
    userByEmail: User,
    auth0Id: string,
    resolvedEmail: string,
  ): Promise<User> {
    const wasPending = userByEmail.auth0Id.startsWith(PENDING_USER_PREFIX);
    if (wasPending) {
      this.logger.log(
        `Linking invited pending user ${resolvedEmail} to real Auth0 ID ${auth0Id}`,
      );
    } else {
      this.logger.warn(
        `Auth0 account linking fallback: relinking ${resolvedEmail} ` +
          `from ${userByEmail.auth0Id} to ${auth0Id}`,
      );
    }
    const updated = await this.usersService.updateAuth0Id(
      userByEmail.id,
      auth0Id,
    );

    if (wasPending) {
      await this.membershipsService.activateInvitedMemberships(userByEmail.id);
    }

    this.legalAudit.recordEvent({
      eventType: wasPending ? 'user.auth0.linked' : 'user.auth0.relinked',
      userId: userByEmail.id,
      triggerType: 'system',
      metadata: {
        previousAuth0Id: userByEmail.auth0Id,
        newAuth0Id: auth0Id,
      },
    });

    return updated;
  }

  private async provisionNewUser(
    auth0Id: string,
    resolvedEmail: string,
    profile?: { firstName?: string; lastName?: string; pictureUrl?: string },
  ): Promise<User> {
    this.logger.log(
      `First login for Auth0 ID: ${auth0Id} -- provisioning user + org`,
    );

    const resolvedProfile = await this.resolveProfile(auth0Id, profile);
    const { user, organization } =
      await this.usersService.provisionWithPersonalOrg(auth0Id, resolvedEmail);
    this.logger.log(`Provisioned user ${user.id} with personal org`);

    // No ambient tenant context can match this org yet (it didn't exist at
    // request start — this is a first-login bootstrap) — override it for
    // this write so the activityLog Proxy (libs/prisma-business) sets
    // app.current_org_id to the org that was just created.
    runWithTenant(organization.id, () => {
      this.activityLog.logActivity({
        orgId: organization.id,
        actorId: user.id,
        action: 'user.provisioned',
        entityType: 'user',
        entityId: user.id,
        metadata: { organizationId: organization.id },
      });
    });

    this.legalAudit.recordEvent({
      eventType: 'user.provisioned',
      orgId: organization.id,
      userId: user.id,
      triggerType: 'system',
      metadata: {
        userId: user.id,
        organizationId: organization.id,
      },
    });

    this.emailService.addContact({
      email: resolvedEmail,
      firstName: resolvedProfile.firstName,
      lastName: resolvedProfile.lastName,
      properties: {
        org_id: organization.id,
        org_name: organization.name,
      },
    });

    if (
      resolvedProfile.firstName ||
      resolvedProfile.lastName ||
      resolvedProfile.pictureUrl
    ) {
      return this.usersService.updateProfile(user.id, resolvedProfile);
    }
    return user;
  }

  private async resolveProfile(
    auth0Id: string,
    profile?: { firstName?: string; lastName?: string; pictureUrl?: string },
  ): Promise<{ firstName?: string; lastName?: string; pictureUrl?: string }> {
    const resolvedProfile = profile ?? {};
    if (
      resolvedProfile.firstName ||
      resolvedProfile.lastName ||
      resolvedProfile.pictureUrl
    ) {
      return resolvedProfile;
    }

    try {
      const identityUser = await this.identityProvider.getUserById(auth0Id);
      return {
        firstName: identityUser.firstName,
        lastName: identityUser.lastName,
        pictureUrl: identityUser.pictureUrl,
      };
    } catch (err) {
      this.logger.warn(
        `Could not fetch identity profile for ${auth0Id} — skipping profile sync`,
        err instanceof Error ? err.message : err,
      );
      return resolvedProfile;
    }
  }

  async updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; pictureUrl?: string },
  ): Promise<User> {
    const updated = await this.usersService.updateProfile(userId, data);

    this.legalAudit.recordEvent({
      eventType: 'user.profile.updated',
      userId,
      triggerType: 'user_action',
      metadata: {
        updatedFields: Object.keys(data).filter(
          (k) => data[k as keyof typeof data] !== undefined,
        ),
      },
    });

    return updated;
  }

  async requestPasswordChange(email: string): Promise<void> {
    await this.identityProvider.sendChangePasswordEmail(email);

    this.legalAudit.recordEvent({
      eventType: 'user.password_change.requested',
      triggerType: 'user_action',
      metadata: {},
    });
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.usersService.findByAuth0Id(auth0Id);
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersService.findById(id);
  }
}
