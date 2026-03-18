import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EmailService } from './email.service';
import { TemplateRendererService } from './templates/template-renderer.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { SendGridProvider } from './providers/sendgrid.provider';

/**
 * Email Module
 *
 * Provides transactional email capabilities via event-driven architecture.
 * Supports multiple email providers (SendGrid, SMTP) with template rendering.
 *
 * Usage:
 * 1. Import EmailModule in your application module
 * 2. Emit domain events (USER_INVITED, EXPORT_COMPLETED, etc.)
 * 3. Email handlers automatically send emails via EmailService
 *
 * Configuration:
 * - EMAIL_PROVIDER: 'sendgrid' | 'smtp'
 * - SENDGRID_API_KEY (if using SendGrid)
 * - EMAIL_FROM_ADDRESS
 * - EMAIL_FROM_NAME
 */
@Module({
  imports: [ConfigModule, ActivityLogModule, LegalAuditModule],
  providers: [
    // Email provider (DI token pattern)
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('email.provider');

        if (provider === 'sendgrid') {
          return new SendGridProvider(configService);
        }

        // Default to SendGrid
        return new SendGridProvider(configService);
      },
      inject: [ConfigService],
    },

    // Core services
    TemplateRendererService,
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
