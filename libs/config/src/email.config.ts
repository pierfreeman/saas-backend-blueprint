import { registerAs } from '@nestjs/config';

export interface EmailConfig {
  provider: 'resend' | 'smtp';
  from: {
    address: string;
    name: string;
  };
  resend?: {
    apiKey: string;
  };
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

export default registerAs(
  'email',
  (): EmailConfig => ({
    provider: (process.env['EMAIL_PROVIDER'] as 'resend' | 'smtp') ?? 'resend',
    from: {
      address: process.env['EMAIL_FROM_ADDRESS'] ?? 'noreply@example.com',
      name: process.env['EMAIL_FROM_NAME'] ?? 'SaaS Backend',
    },
    resend: {
      apiKey: process.env['RESEND_API_KEY'] ?? '',
    },
    smtp: {
      host: process.env['SMTP_HOST'] ?? '',
      port: Number.parseInt(process.env['SMTP_PORT'] ?? '587', 10),
      secure: process.env['SMTP_SECURE'] === 'true',
      auth: {
        user: process.env['SMTP_USER'] ?? '',
        pass: process.env['SMTP_PASS'] ?? '',
      },
    },
  }),
);
