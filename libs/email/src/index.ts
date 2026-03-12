// Module
export { EmailModule } from './lib/email.module';

// Service
export { EmailService } from './lib/email.service';
export type { SendTransactionalEmailInput } from './lib/email.service';

// Provider abstraction
export { EMAIL_PROVIDER_TOKEN } from './lib/providers/email-provider.interface';
export type { EmailProvider } from './lib/providers/email-provider.interface';

// Concrete providers
export { SendGridProvider } from './lib/providers/sendgrid.provider';

// Template system
export { TemplateService } from './lib/templates/template.service';
export { TemplateRenderer } from './lib/templates/template.renderer';

// Event handlers
export { UserInvitedEmailHandler } from './lib/events/handlers/user-invited.handler';
export type { UserInvitedPayload } from './lib/events/handlers/user-invited.handler';
export { ExportCompletedEmailHandler } from './lib/events/handlers/export-completed.handler';
export type { ExportCompletedPayload } from './lib/events/handlers/export-completed.handler';

// Types
export type {
  EmailTemplateName,
  EmailTemplateData,
  AuthLoginLinkData,
  UserInviteData,
  ExportReadyData,
  SystemAlertData,
} from './lib/types/email-template.type';

// DTOs
export { SendEmailDto } from './lib/dto/send-email.dto';
