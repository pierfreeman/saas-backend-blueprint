import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ActivityLogModule } from '@libs/activity-log';
import { EventsModule } from '@libs/events';
import { emailConfig } from '@libs/config';
import { EmailService } from './email.service';
import { SendGridProvider } from './providers/sendgrid.provider';
import { TemplateService } from './templates/template.service';
import { UserInvitedEmailHandler } from './events/handlers/user-invited.handler';
import { ExportCompletedEmailHandler } from './events/handlers/export-completed.handler';
import { EMAIL_PROVIDER_TOKEN } from './providers/email-provider.interface';

/**
 * EmailModule
 *
 * Provides transactional email capabilities to the application.
 *
 * Architecture:
 *   Domain Event → Event Handler → EmailService → EmailProvider (SendGrid)
 *
 * Included providers:
 *   - EmailService        — template rendering + provider dispatch + audit logging.
 *   - SendGridProvider    — concrete implementation of EmailProvider via @sendgrid/mail.
 *   - TemplateService     — Handlebars template rendering wrapper.
 *   - UserInvitedEmailHandler     — listens for `user.invited` events.
 *   - ExportCompletedEmailHandler — listens for `export.completed` events.
 *
 * Configuration required (via ConfigModule / environment variables):
 *   SENDGRID_API_KEY    — SendGrid API key.
 *   EMAIL_FROM_ADDRESS  — Sender address.
 *   EMAIL_FROM_NAME     — Sender display name.
 *   EMAIL_PROVIDER      — Provider selector (default: 'sendgrid').
 *
 * Exports:
 *   EmailService — allows other modules to send transactional emails directly.
 */
@Module({
  imports: [
    ConfigModule.forFeature(emailConfig),
    ActivityLogModule,
    EventsModule,
  ],
  providers: [
    TemplateService,
    SendGridProvider,
    {
      provide: EMAIL_PROVIDER_TOKEN,
      useExisting: SendGridProvider,
    },
    EmailService,
    UserInvitedEmailHandler,
    ExportCompletedEmailHandler,
  ],
  exports: [EmailService],
})
export class EmailModule {}
