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
import { EmailService } from '@libs/email';
import { InviteMemberDto } from './dto/invite-member.dto';
import { PENDING_AUTH0_ID_PREFIX } from '../auth/auth.service';

export interface InviteMemberResult {
  message: string;
}

/**
 * InviteMemberService
 *
 * Orchestrates the email-based member invite flow:
 *
 * 1. Resolve org and inviter details for email content.
 * 2. Resolve or create the invited user in Prisma:
 *    - Existing Prisma user → reuse.
 *    - New user → create a placeholder record (`auth0Id = pending:<uuid>`).
 *      On first login Auth0 provides the real sub; AuthService.syncUser
 *      detects the placeholder and updates it automatically.
 * 3. Guard against duplicate memberships.
 * 4. Create the membership (status INVITED).
 * 5. Send an invite email via SendGrid with a link to the app login page.
 *    The invitee signs up / logs in, and AuthService.syncUser links the real
 *    Auth0 ID to the pending Prisma record on first login.
 */
@Injectable()
export class InviteMemberService {
  private readonly logger = new Logger(InviteMemberService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly membershipsService: MembershipsService,
    private readonly organizationsService: OrganizationsService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async invite(
    dto: InviteMemberDto,
    orgId: string,
    inviterUserId: string,
  ): Promise<InviteMemberResult> {
    const email = dto.email.toLowerCase();

    // 1. Fetch org + inviter concurrently
    const [org, inviter] = await Promise.all([
      this.organizationsService.findById(orgId),
      this.usersService.findById(inviterUserId),
    ]);

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

    // 5. Send invite email via SendGrid
    const baseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') ??
      'http://localhost:4200';

    await this.emailService.sendTransactionalEmail({
      templateName: 'user-invite',
      recipient: email,
      subject: `You've been invited to join ${org.name}`,
      data: {
        inviteeName: email.split('@')[0],
        inviterName: inviter?.email ?? 'A team member',
        organizationName: org.name,
        role: dto.role.toLowerCase(),
        inviteUrl: baseUrl,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      orgId,
      userId: inviterUserId,
    });

    this.logger.log(`Invite sent to ${email} for org ${orgId}.`);

    return { message: 'Invitation sent successfully.' };
  }
}
