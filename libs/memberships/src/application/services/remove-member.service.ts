import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UsersService } from '@libs/users';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { PENDING_USER_PREFIX, IIdentityProvider } from '@libs/common';
import { runWithTenantUser } from '@libs/prisma-business';
import { MembershipsService } from './memberships.service';

@Injectable()
export class RemoveMemberService {
  private readonly logger = new Logger(RemoveMemberService.name);

  constructor(
    private readonly membershipsService: MembershipsService,
    private readonly usersService: UsersService,
    private readonly identityProvider: IIdentityProvider,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  /**
   * Removes a membership from an organization.
   *
   * After deletion, if the user has no remaining memberships, their Prisma
   * record and Auth0 account are permanently deleted (full account cleanup).
   * Users who were only invited but never logged in (auth0Id starts with
   * `pending:`) have no Auth0 account, so only the Prisma record is removed.
   */
  async remove(
    membershipId: string,
    orgId: string,
    actorUserId?: string,
    triggerType = 'user_action',
  ): Promise<void> {
    // 1. Fetch BEFORE deletion to capture userId for cleanup check
    const membership = await this.membershipsService.findById(membershipId);
    if (!membership?.orgId || membership.orgId !== orgId) {
      throw new NotFoundException('Membership not found');
    }
    const { userId } = membership;

    // 2. Delete the membership (audit logging handled inside service)
    await this.membershipsService.deleteMembership(
      membershipId,
      orgId,
      actorUserId,
      triggerType,
    );

    // 3. Check whether the user still belongs to any organization.
    // `userId` here is the *removed member's* id, not the actor's (the
    // ambient tenant context carries the actor's id, set by
    // OrgContextGuard/TenantContextInterceptor) — and this legitimately
    // spans every org the removed user belongs to, not just the current
    // one. Override with the removed user's own id so the memberships RLS
    // policy's user_id exception applies.
    const remaining = await runWithTenantUser(userId, () =>
      this.membershipsService.findByUser(userId),
    );
    if (remaining.length > 0) {
      // User still has other memberships — keep their account intact
      return;
    }

    // 4. No remaining memberships — full account cleanup
    const user = await this.usersService.findById(userId);
    if (!user) return;

    // Delete Auth0 user first (best-effort; non-fatal if it fails)
    if (user.auth0Id.startsWith(PENDING_USER_PREFIX)) {
      this.logger.log(
        `Skipping Auth0 deletion for pending user ${userId} (never logged in)`,
      );
    } else {
      try {
        await this.identityProvider.deleteUser(user.auth0Id);
        this.logger.log(`Deleted Auth0 user ${user.auth0Id}`);

        this.activityLog.logActivity({
          orgId,
          actorId: actorUserId,
          action: 'user.auth0.deleted',
          entityType: 'user',
          entityId: userId,
          metadata: { triggerType },
        });
        this.legalAudit.recordEvent({
          eventType: 'user.auth0.deleted',
          orgId,
          userId: actorUserId,
          triggerType,
          metadata: { deletedUserId: userId },
        });
      } catch (err) {
        this.logger.warn(
          `Could not delete Auth0 user ${user.auth0Id} — manual cleanup may be required. ` +
            `Reason: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Delete the Prisma user record (cascades any leftover memberships)
    await this.usersService.deleteUser(userId);
    this.logger.log(`Deleted Prisma user ${userId}`);

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'user.deleted',
      entityType: 'user',
      entityId: userId,
      metadata: { triggerType },
    });
    this.legalAudit.recordEvent({
      eventType: 'user.deleted',
      orgId,
      userId: actorUserId,
      triggerType,
      metadata: { deletedUserId: userId },
    });
  }
}
