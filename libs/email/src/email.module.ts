import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EmailService } from './email.service';
import { TemplateRendererService } from './templates/template-renderer.service';
import { EMAIL_PROVIDER } from './providers/email-provider.interface';
import { SendGridProvider } from './providers/sendgrid.provider';
import { SmtpProvider } from './providers/smtp.provider';

@Module({
  imports: [ConfigModule, ActivityLogModule, LegalAuditModule],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('email.provider');
        if (provider === 'smtp') {
          return new SmtpProvider(configService);
        }
        return new SendGridProvider(configService);
      },
      inject: [ConfigService],
    },
    TemplateRendererService,
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
