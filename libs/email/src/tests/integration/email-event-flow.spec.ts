import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../lib/email.service';
import { EMAIL_PROVIDER_TOKEN } from '../../lib/providers/email-provider.interface';
import { TemplateService } from '../../lib/templates/template.service';
import { ActivityLogService } from '@libs/activity-log';
import { LocalTransport, DOMAIN_EVENTS } from '@libs/events';
import { UserInvitedEmailHandler } from '../../lib/events/handlers/user-invited.handler';
import { ExportCompletedEmailHandler } from '../../lib/events/handlers/export-completed.handler';

/**
 * Email Event Flow Integration Test
 *
 * Validates the full event-driven email pipeline:
 *   Domain Event → Event Handler → EmailService → EmailProvider (mocked)
 *
 * The SendGrid provider is mocked to prevent real email delivery.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSendEmail = jest.fn().mockResolvedValue(undefined);

const mockEmailProvider = { sendEmail: mockSendEmail };

const mockActivityLog = { logActivity: jest.fn() };

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, unknown> = {
      'email.sendgrid': { apiKey: 'SG.test-key' },
      'email.from.address': 'noreply@test.com',
      'email.from.name': 'Test Platform',
    };
    return config[key];
  }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Email Event Flow (integration)', () => {
  let module: TestingModule;
  let localTransport: LocalTransport;
  let emailService: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();

    module = await Test.createTestingModule({
      providers: [
        LocalTransport,
        TemplateService,
        EmailService,
        { provide: EMAIL_PROVIDER_TOKEN, useValue: mockEmailProvider },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: ConfigService, useValue: mockConfigService },
        UserInvitedEmailHandler,
        ExportCompletedEmailHandler,
      ],
    }).compile();

    await module.init();

    localTransport = module.get<LocalTransport>(LocalTransport);
    emailService = module.get<EmailService>(EmailService);
  });

  afterEach(async () => {
    await module.close();
  });

  describe('UserInvitedEvent → UserInvitedEmailHandler → EmailService', () => {
    it('triggers email sending when user.invited event is emitted', async () => {
      await localTransport.send({
        eventType: DOMAIN_EVENTS.USER_INVITED,
        timestamp: new Date(),
        payload: {
          recipientEmail: 'newuser@example.com',
          recipientName: 'New User',
          inviterName: 'Alice',
          orgId: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
          orgName: 'Acme Corp',
          inviteUrl: 'https://example.com/invite/abc123',
          expiresInDays: 7,
        },
      });

      // Allow async handler to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newuser@example.com',
          subject: expect.stringContaining('Acme Corp'),
          html: expect.stringContaining('Alice'),
        }),
      );
    });

    it('skips email when recipientEmail is missing', async () => {
      await localTransport.send({
        eventType: DOMAIN_EVENTS.USER_INVITED,
        timestamp: new Date(),
        payload: {
          inviterName: 'Alice',
          orgId: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
          orgName: 'Acme Corp',
          inviteUrl: 'https://example.com/invite/abc123',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe('ExportCompletedEvent → ExportCompletedEmailHandler → EmailService', () => {
    it('triggers email sending when export.completed event is emitted', async () => {
      await localTransport.send({
        eventType: DOMAIN_EVENTS.EXPORT_COMPLETED,
        timestamp: new Date(),
        payload: {
          recipientEmail: 'user@example.com',
          recipientName: 'Bob',
          orgId: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
          exportName: 'Q4 Report',
          downloadUrl: 'https://example.com/exports/q4report.csv',
          expiresInHours: 48,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('Q4 Report'),
          html: expect.stringContaining('Q4 Report'),
        }),
      );
    });
  });

  describe('EmailService direct invocation', () => {
    it('can send a transactional email directly via EmailService', async () => {
      await emailService.sendTransactionalEmail({
        to: 'direct@example.com',
        subject: 'Direct Test',
        template: 'system-alert',
        templateData: {
          alertType: 'INFO',
          message: 'Test message',
        },
      });

      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'direct@example.com',
          subject: 'Direct Test',
        }),
      );
    });
  });
});
