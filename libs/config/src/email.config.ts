import { registerAs } from '@nestjs/config';

export interface EmailConfig {
  provider: 'sendgrid';
  sendgrid: {
    apiKey: string;
  };
  from: {
    address: string;
    name: string;
  };
}

export default registerAs(
  'email',
  (): EmailConfig => ({
    provider:
      (process.env['EMAIL_PROVIDER'] as 'sendgrid' | undefined) ?? 'sendgrid',
    sendgrid: {
      apiKey: process.env['SENDGRID_API_KEY'] ?? '',
    },
    from: {
      address: process.env['EMAIL_FROM_ADDRESS'] ?? 'noreply@example.com',
      name: process.env['EMAIL_FROM_NAME'] ?? 'SaaS Platform',
    },
  }),
);
