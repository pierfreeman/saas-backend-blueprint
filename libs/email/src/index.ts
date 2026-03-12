// Module
export * from './lib/email.module';

// Services
export * from './lib/email.service';
export * from './lib/templates/template-renderer.service';

// Providers
export * from './lib/providers/email-provider.interface';
export * from './lib/providers/sendgrid.provider';

// Event Handlers
export * from './lib/events/handlers/user-invited.handler';
export * from './lib/events/handlers/export-completed.handler';

// DTOs
export * from './lib/dto/send-email.dto';

// Types
export * from './lib/types/email-template.type';

