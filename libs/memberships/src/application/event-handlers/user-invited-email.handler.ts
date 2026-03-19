import { Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@libs/events';
import { EmailService } from '@libs/email';

export interface UserInvitedPayload {
  [key: string]: unknown;
  inviteeName: string;
  inviteeEmail: string;
  inviterName: string;
  organizationName: string;
  organizationId: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}

/**
 * Listens for USER_INVITED events and sends invitation emails.
 * Registered in MembershipsModule as a provider.
 */
@Injectable()
export class UserInvitedEmailHandler {
  private readonly logger = new Logger(UserInvitedEmailHandler.name);

  constructor(private readonly emailService: EmailService) {}

  async handle(event: DomainEvent<UserInvitedPayload>): Promise<void> {
    try {
      const { payload, tenantId, userId } = event;

      this.logger.log(
        `Processing USER_INVITED event for ${payload.inviteeEmail}`,
      );

      await this.emailService.sendTransactionalEmail({
        templateName: 'user-invite',
        recipient: payload.inviteeEmail,
        subject: `You've been invited to join ${payload.organizationName}`,
        data: {
          inviteeName: payload.inviteeName,
          inviterName: payload.inviterName,
          organizationName: payload.organizationName,
          role: payload.role,
          inviteUrl: payload.inviteUrl,
          expiresAt: payload.expiresAt,
        },
        orgId: payload.organizationId || tenantId,
        userId,
      });

      this.logger.log(
        `User invitation email initiated for ${payload.inviteeEmail}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle USER_INVITED event: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Don't rethrow — email failures should not abort event processing
    }
  }
}
