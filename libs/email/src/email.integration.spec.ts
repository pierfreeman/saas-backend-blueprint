import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as SendGridMail from '@sendgrid/mail';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';

// Mock SendGrid module
jest.mock('@sendgrid/mail');

describe('Email Integration Tests', () => {
  let module: TestingModule;
  let emailService: EmailService;
  let emailProvider: EmailProvider;

  beforeEach(async () => {
    // Mock SendGrid
    (SendGridMail.send as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ statusCode: 202 }]);
    (SendGridMail.setApiKey as jest.Mock) = jest.fn();

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              email: {
                provider: 'sendgrid',
                from: {
                  address: 'noreply@test.com',
                  name: 'Test System',
                },
                sendgrid: {
                  apiKey: 'test-api-key',
                },
              },
            }),
          ],
        }),
        EmailModule,
      ],
    }).compile();

    emailService = module.get<EmailService>(EmailService);
    emailProvider = module.get<EmailProvider>(EMAIL_PROVIDER);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('EmailService Direct Usage', () => {
    it('should send email directly via EmailService', async () => {
      await emailService.sendTransactionalEmail({
        templateName: 'auth-login-link',
        recipient: 'test@example.com',
        subject: 'Sign in to your account',
        data: {
          userName: 'Test User',
          loginUrl: 'https://app.example.com/auth/login/xyz789',
          expirationMinutes: 15,
        },
        orgId: 'org-test',
        userId: 'user-test',
      });

      // Wait for async email sending
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(SendGridMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Sign in to your account',
        }),
      );
    });
  });

  describe('Module Configuration', () => {
    it('should provide EmailService', () => {
      expect(emailService).toBeDefined();
    });

    it('should provide email provider', () => {
      expect(emailProvider).toBeDefined();
    });

    it('should initialize SendGrid with API key', () => {
      expect(SendGridMail.setApiKey).toHaveBeenCalledWith('test-api-key');
    });
  });
});
