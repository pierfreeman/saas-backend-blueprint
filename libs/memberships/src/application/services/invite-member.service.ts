import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipRole } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { MembershipsService } from './memberships.service';
import { OrganizationsService } from '@libs/organizations';
import { UsersService } from '@libs/users';
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { PENDING_AUTH0_ID_PREFIX } from '@libs/auth/constants';
import { Auth0ManagementService } from '@libs/auth/infrastructure/clients/auth0-management.service';

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
    private readonly eventBus: EventBusService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  async invite(
    email: string,
    role: MembershipRole,
    orgId: string,
    inviterUserId: string,
    triggerType = 'user_action',
  ): Promise<InviteMemberResult> {
    const normalizedEmail = email.toLowerCase();

    // 1. Fetch org
    const org = await this.organizationsService.findById(orgId);

    if (!org) {
      throw new NotFoundException(`Organization ${orgId} not found.`);
    }

    // 2. Resolve invited user
    let user = await this.usersService.findByEmail(normalizedEmail);

    if (!user) {
      this.logger.log(
        `User ${normalizedEmail} not found in Prisma — creating pending record.`,
      );
      // Create a placeholder Prisma record. The auth0Id is replaced with the
      // real Auth0 sub on the user's first login (see AuthService.syncUser).
      user = await this.usersService.createUser(
        `${PENDING_AUTH0_ID_PREFIX}${randomUUID()}`,
        normalizedEmail,
      );

      this.activityLog.logActivity({
        orgId,
        actorId: inviterUserId,
        action: 'user.created.pending',
        entityType: 'user',
        entityId: user.id,
        metadata: { email: normalizedEmail, triggerType },
      });
      this.legalAudit.recordEvent({
        eventType: 'user.created.pending',
        orgId,
        userId: inviterUserId,
        triggerType: triggerType as string,
        metadata: { createdUserId: user.id },
      });
    }

    // 3. Guard: prevent duplicate membership
    const existing = await this.membershipsService.findByUserAndOrg(
      user.id,
      orgId,
    );
    if (existing) {
      throw new ConflictException(
        `${normalizedEmail} is already a member of this organization.`,
      );
    }

    // 4. Create membership
    await this.membershipsService.createMembership(
      orgId,
      { userId: user.id, role },
      inviterUserId,
      triggerType,
    );

    // 5. Send passwordless magic-link unless the user is on a social connection.
    //    Social-connection users (google-oauth2|, github|, …) cannot receive a
    //    passwordless link — Auth0 returns 400 (connection mismatch) for them.
    //    New/pending users and database-connection users (auth0|) can.
    const isSocialConnection =
      !user.auth0Id.startsWith(PENDING_AUTH0_ID_PREFIX) &&
      !user.auth0Id.startsWith('auth0|');

    const baseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') ??
      'http://localhost:4200';

    if (!isSocialConnection) {
      const redirectUri = `${baseUrl}/auth/callback`;

      try {
        await this.auth0ManagementService.sendPasswordlessLink(
          normalizedEmail,
          redirectUri,
        );
      } catch (err) {
        // Auth0 passwordless is optional — the invite email is sent via
        // the USER_INVITED event (Resend). Log the failure but don't 500.
        this.logger.warn(
          `Auth0 passwordless link failed for ${normalizedEmail}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Invite sent to ${normalizedEmail} for org ${orgId}.`);

    // 6. Publish USER_INVITED domain event → triggers invitation email via worker
    // Resolve inviter's display name — prefer "First Last", fall back to email.
    const inviter = await this.usersService.findById(inviterUserId);
    const inviterName = inviter
      ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ') ||
        inviter.email
      : inviterUserId;

    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.USER_INVITED,
      timestamp: new Date(),
      tenantId: orgId,
      userId: inviterUserId,
      payload: {
        inviteeName: normalizedEmail,
        inviteeEmail: normalizedEmail,
        inviterName,
        organizationName: org.name,
        organizationId: orgId,
        role,
        inviteUrl: `${baseUrl}/auth/callback`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { message: 'Invitation sent successfully.' };
  }
}
