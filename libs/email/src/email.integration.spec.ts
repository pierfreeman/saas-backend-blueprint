import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import { vi } from 'vitest';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';

// Hoist mocks so the factory below can reference them (vi.hoisted runs
// before vi.mock factories and module imports).
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

// Mock the Resend SDK — constructor returns an object with emails.send().
vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

describe('Email Integration Tests', () => {
  let module: TestingModule;
  let emailService: EmailService;
  let emailProvider: EmailProvider;

  beforeEach(async () => {
    // Reset mocks between tests
    mockSend
      .mockReset()
      .mockResolvedValue({ data: { id: 'msg-123' }, error: null });

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              email: {
                provider: 'resend',
                from: {
                  address: 'noreply@test.com',
                  name: 'Test System',
                },
                resend: {
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
        orgId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      });

      // Wait for async email sending
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['test@example.com'],
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
  });
});
