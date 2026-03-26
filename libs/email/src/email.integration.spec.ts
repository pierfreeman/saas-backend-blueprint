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
const { mockSend, mockSetApiKey } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSetApiKey: vi.fn(),
}));

// Explicit factory: the @sendgrid/mail package uses `export =` (CJS singleton).
// When compiled via esModuleInterop the provider resolves `SendGridMail.default`
// first, so we must stub *both* the default export and the named exports with
// the same mock functions to guarantee the same reference is checked in
// assertions regardless of which resolution path the provider takes.
vi.mock('@sendgrid/mail', () => ({
  __esModule: true,
  default: { send: mockSend, setApiKey: mockSetApiKey },
  send: mockSend,
  setApiKey: mockSetApiKey,
}));

describe('Email Integration Tests', () => {
  let module: TestingModule;
  let emailService: EmailService;
  let emailProvider: EmailProvider;

  beforeEach(async () => {
    // Reset mocks between tests — must call mockReset on the shared functions
    // (not reassign them, which would break the reference inside the module).
    mockSend.mockReset().mockResolvedValue([{ statusCode: 202 }]);
    mockSetApiKey.mockReset();

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
        orgId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
      });

      // Wait for async email sending
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockSend).toHaveBeenCalledWith(
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
      expect(mockSetApiKey).toHaveBeenCalledWith('test-api-key');
    });
  });
});
