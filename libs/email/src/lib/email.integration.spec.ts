import { DOMAIN_EVENTS, DomainEvent } from '@libs/events';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as SendGridMail from '@sendgrid/mail';
import { EmailModule } from './email.module';
import { EmailService } from './email.service';
import {
  ExportCompletedEmailHandler,
  ExportCompletedPayload,
} from './events/handlers/export-completed.handler';
import {
  UserInvitedEmailHandler,
  UserInvitedPayload,
} from './events/handlers/user-invited.handler';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';

// Mock SendGrid module
jest.mock('@sendgrid/mail');

describe('Email Integration Tests', () => {
  let module: TestingModule;
  let emailService: EmailService;
  let userInvitedHandler: UserInvitedEmailHandler;
  let exportCompletedHandler: ExportCompletedEmailHandler;
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
    userInvitedHandler = module.get<UserInvitedEmailHandler>(
      UserInvitedEmailHandler,
    );
    exportCompletedHandler = module.get<ExportCompletedEmailHandler>(
      ExportCompletedEmailHandler,
    );
    emailProvider = module.get<EmailProvider>(EMAIL_PROVIDER);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('User Invited Flow', () => {
    it('should send invitation email when USER_INVITED event is handled', async () => {
      const event: DomainEvent<UserInvitedPayload> = {
        eventType: DOMAIN_EVENTS.USER_INVITED,
        timestamp: new Date(),
        payload: {
          inviteeName: 'John Doe',
          inviteeEmail: 'john@example.com',
          inviterName: 'Jane Smith',
          organizationName: 'Acme Corp',
          organizationId: 'org-123',
          role: 'Admin',
          inviteUrl: 'https://app.example.com/invite/abc123',
          expiresAt: new Date('2026-04-01'),
        },
        tenantId: 'org-123',
        userId: 'user-456',
      };

      await userInvitedHandler.handle(event);

      // Wait for async email sending
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify SendGrid was called
      expect(SendGridMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'john@example.com',
          subject: expect.stringContaining('Acme Corp'),
          html: expect.stringContaining('John Doe'),
        }),
      );
    });

    it('should not throw error if email sending fails', async () => {
      (SendGridMail.send as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('SendGrid error'));

      const event: DomainEvent<UserInvitedPayload> = {
        eventType: DOMAIN_EVENTS.USER_INVITED,
        timestamp: new Date(),
        payload: {
          inviteeName: 'John Doe',
          inviteeEmail: 'john@example.com',
          inviterName: 'Jane Smith',
          organizationName: 'Acme Corp',
          organizationId: 'org-123',
          role: 'Admin',
          inviteUrl: 'https://app.example.com/invite/abc123',
          expiresAt: new Date('2026-04-01'),
        },
      };

      // Should not throw
      await expect(userInvitedHandler.handle(event)).resolves.not.toThrow();

      // Wait for fire-and-forget to complete before module teardown
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  describe('Export Completed Flow', () => {
    it('should send export ready email when EXPORT_COMPLETED event is handled', async () => {
      const event: DomainEvent<ExportCompletedPayload> = {
        eventType: DOMAIN_EVENTS.EXPORT_COMPLETED,
        timestamp: new Date(),
        payload: {
          userName: 'Jane Doe',
          userEmail: 'jane@example.com',
          userId: 'user-789',
          organizationId: 'org-456',
          exportType: 'Customer Data',
          fileSize: '2.5 MB',
          recordCount: 1500,
          completedAt: new Date('2026-03-12'),
          downloadUrl: 'https://app.example.com/download/export123',
          downloadExpirationDays: 7,
        },
        tenantId: 'org-456',
      };

      await exportCompletedHandler.handle(event);

      // Wait for async email sending
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify SendGrid was called
      expect(SendGridMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane@example.com',
          subject: expect.stringContaining('Customer Data'),
          html: expect.stringContaining('Jane Doe'),
        }),
      );
    });

    it('should not throw error if email sending fails', async () => {
      (SendGridMail.send as jest.Mock) = jest
        .fn()
        .mockRejectedValue(new Error('SendGrid error'));

      const event: DomainEvent<ExportCompletedPayload> = {
        eventType: DOMAIN_EVENTS.EXPORT_COMPLETED,
        timestamp: new Date(),
        payload: {
          userName: 'Jane Doe',
          userEmail: 'jane@example.com',
          userId: 'user-789',
          organizationId: 'org-456',
          exportType: 'Customer Data',
          fileSize: '2.5 MB',
          recordCount: 1500,
          completedAt: new Date(),
          downloadUrl: 'https://app.example.com/download/export123',
          downloadExpirationDays: 7,
        },
      };

      // Should not throw
      await expect(exportCompletedHandler.handle(event)).resolves.not.toThrow();

      // Wait for fire-and-forget to complete before module teardown
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
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

    it('should provide event handlers', () => {
      expect(userInvitedHandler).toBeDefined();
      expect(exportCompletedHandler).toBeDefined();
    });

    it('should provide email provider', () => {
      expect(emailProvider).toBeDefined();
    });

    it('should initialize SendGrid with API key', () => {
      expect(SendGridMail.setApiKey).toHaveBeenCalledWith('test-api-key');
    });
  });
});
