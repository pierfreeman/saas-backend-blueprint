import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LocalTransport } from '@libs/events';
import { DOMAIN_EVENTS } from '@libs/events';
import { EmailService } from '../../email.service';
import type { DomainEvent } from '@libs/events';
import type { UserInviteData } from '../../types/email-template.type';

export interface UserInvitedPayload {
  recipientEmail: string;
  recipientName?: string;
  inviterName: string;
  orgId: string;
  orgName: string;
  inviteUrl: string;
  expiresInDays?: number;
}

/**
 * UserInvitedEmailHandler
 *
 * Listens for `user.invited` domain events and sends an invitation email.
 *
 * Event flow:
 *   UserInvitedEvent (user.invited)
 *     → UserInvitedEmailHandler
 *     → EmailService.sendTransactionalEmail
 *     → SendGridProvider
 */
@Injectable()
export class UserInvitedEmailHandler implements OnModuleInit {
  private readonly logger = new Logger(UserInvitedEmailHandler.name);

  constructor(
    private readonly localTransport: LocalTransport,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit(): void {
    this.localTransport.on(
      DOMAIN_EVENTS.USER_INVITED,
      (event: DomainEvent) => {
        void this.handle(event);
      },
    );
    this.logger.log(`Subscribed to "${DOMAIN_EVENTS.USER_INVITED}" events.`);
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as unknown as UserInvitedPayload;

    if (!payload.recipientEmail || !payload.orgId) {
      this.logger.warn(
        `UserInvitedEmailHandler: missing required fields in payload. Skipping.`,
      );
      return;
    }

    const templateData: UserInviteData = {
      inviterName: payload.inviterName ?? 'A team member',
      orgName: payload.orgName ?? 'our organisation',
      inviteUrl: payload.inviteUrl,
      recipientName: payload.recipientName,
      expiresInDays: payload.expiresInDays,
    };

    await this.emailService.sendTransactionalEmail({
      to: payload.recipientEmail,
      subject: `You've been invited to join ${templateData.orgName}`,
      template: 'user-invite',
      templateData,
      orgId: payload.orgId,
    });
  }
}
