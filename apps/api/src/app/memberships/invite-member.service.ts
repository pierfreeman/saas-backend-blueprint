import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipsService } from '@libs/memberships';
import { OrganizationsService } from '@libs/organizations';
import { UsersService } from '@libs/users';
import { InviteMemberDto } from './dto/invite-member.dto';
import { PENDING_AUTH0_ID_PREFIX } from '../auth/auth.service';
import { Auth0ManagementService } from '../auth/auth0-management.service';

export interface InviteMemberResult {
  message: string;
}

/**
 * InviteMemberService
 *
 * Orchestrates the email-based member invite flow for apps using
 * passwordless / social (Google) login:
 *
 * 1. Resolve org details.
 * 2. Resolve or create the invited user in Prisma:
 *    - Existing Prisma user → reuse.
 *    - New user → create a placeholder record (`auth0Id = pending:<uuid>`).
 *      On first login Auth0 provides the real sub; AuthService.syncUser
 *      detects the placeholder and updates it automatically ("account link").
 * 3. Guard against duplicate memberships.
 * 4. Create the membership.
 * 5. Send a passwordless magic-link email via Auth0 (/passwordless/start).
 *    The invitee clicks the link, authenticates, and is redirected to the
 *    frontend — at which point AuthService.syncUser links the real Auth0 ID
 *    to the pending Prisma record.
 */
@Injectable()
export class InviteMemberService {
  private readonly logger = new Logger(InviteMemberService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly membershipsService: MembershipsService,
    private readonly organizationsService: OrganizationsService,
    private readonly auth0ManagementService: Auth0ManagementService,
    private readonly configService: ConfigService,
  ) {}

  async invite(
    dto: InviteMemberDto,
    orgId: string,
    inviterUserId: string,
  ): Promise<InviteMemberResult> {
    const email = dto.email.toLowerCase();

    // 1. Fetch org
    const org = await this.organizationsService.findById(orgId);

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found.`);
    }

    // 2. Resolve invited user
    let user = await this.usersService.findByEmail(email);

    if (!user) {
      this.logger.log(
        `User ${email} not found in Prisma — creating pending record.`,
      );
      // Create a placeholder Prisma record. The auth0Id is replaced with the
      // real Auth0 sub on the user's first login (see AuthService.syncUser).
      user = await this.usersService.createUser(
        `${PENDING_AUTH0_ID_PREFIX}${randomUUID()}`,
        email,
      );
    }

    // 3. Guard: prevent duplicate membership
    const existing = await this.membershipsService.findByUserAndOrg(
      user.id,
      orgId,
    );
    if (existing) {
      throw new ConflictException(
        `${email} is already a member of this organization.`,
      );
    }

    // 4. Create membership
    await this.membershipsService.createMembership(
      orgId,
      { userId: user.id, role: dto.role },
      inviterUserId,
    );

    // 5. Send passwordless magic-link unless the user is on a social connection.
    //    Social-connection users (google-oauth2|, github|, …) cannot receive a
    //    passwordless link — Auth0 returns 400 (connection mismatch) for them.
    //    New/pending users and database-connection users (auth0|) can.
    const isSocialConnection =
      !user.auth0Id.startsWith(PENDING_AUTH0_ID_PREFIX) &&
      !user.auth0Id.startsWith('auth0|');

    if (!isSocialConnection) {
      const baseUrl =
        this.configService.get<string>('FRONTEND_BASE_URL') ??
        'http://localhost:4200';
      const redirectUri = `${baseUrl}/auth/callback`;

      await this.auth0ManagementService.sendPasswordlessLink(
        email,
        redirectUri,
      );
    }

    this.logger.log(`Invite sent to ${email} for org ${orgId}.`);

    return { message: 'Invitation sent successfully.' };
  }
}
