import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from '../../lib/email.service';
import { EMAIL_PROVIDER_TOKEN } from '../../lib/providers/email-provider.interface';
import { TemplateService } from '../../lib/templates/template.service';
import { ActivityLogService } from '@libs/activity-log';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockEmailProvider = {
  sendEmail: jest.fn().mockResolvedValue(undefined),
};

const mockTemplateService = {
  render: jest.fn().mockReturnValue('<p>Hello World</p>'),
};

const mockActivityLog = {
  logActivity: jest.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: EMAIL_PROVIDER_TOKEN, useValue: mockEmailProvider },
        { provide: TemplateService, useValue: mockTemplateService },
        { provide: ActivityLogService, useValue: mockActivityLog },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  describe('sendTransactionalEmail', () => {
    it('renders the template and calls the provider', async () => {
      await service.sendTransactionalEmail({
        to: 'user@example.com',
        subject: 'Welcome',
        template: 'user-invite',
        templateData: {
          inviterName: 'Alice',
          orgName: 'Acme',
          inviteUrl: 'https://example.com',
        },
        orgId: ORG_UUID,
      });

      expect(mockTemplateService.render).toHaveBeenCalledWith(
        'user-invite',
        expect.objectContaining({ inviterName: 'Alice' }),
      );

      expect(mockEmailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Welcome',
          html: '<p>Hello World</p>',
        }),
      );
    });

    it('emits EMAIL_SENT audit log on success', async () => {
      await service.sendTransactionalEmail({
        to: 'user@example.com',
        subject: 'Welcome',
        template: 'user-invite',
        templateData: { inviterName: 'Alice', orgName: 'Acme', inviteUrl: '' },
        orgId: ORG_UUID,
      });

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_UUID,
          action: 'email.sent',
          metadata: expect.objectContaining({
            recipient: 'user@example.com',
            template: 'user-invite',
            status: 'sent',
          }),
        }),
      );
    });

    it('emits EMAIL_FAILED audit log when provider throws', async () => {
      mockEmailProvider.sendEmail.mockRejectedValueOnce(
        new Error('SendGrid error'),
      );

      await service.sendTransactionalEmail({
        to: 'user@example.com',
        subject: 'Welcome',
        template: 'user-invite',
        templateData: { inviterName: 'Alice', orgName: 'Acme', inviteUrl: '' },
        orgId: ORG_UUID,
      });

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_UUID,
          action: 'email.failed',
          metadata: expect.objectContaining({
            status: 'failed',
          }),
        }),
      );
    });

    it('does not propagate provider errors to the caller', async () => {
      mockEmailProvider.sendEmail.mockRejectedValueOnce(
        new Error('Network failure'),
      );

      await expect(
        service.sendTransactionalEmail({
          to: 'user@example.com',
          subject: 'Test',
          template: 'user-invite',
          templateData: { inviterName: 'Alice', orgName: 'Acme', inviteUrl: '' },
          orgId: ORG_UUID,
        }),
      ).resolves.toBeUndefined();
    });

    it('handles template render failure gracefully', async () => {
      mockTemplateService.render.mockImplementationOnce(() => {
        throw new Error('Template not found');
      });

      await expect(
        service.sendTransactionalEmail({
          to: 'user@example.com',
          subject: 'Test',
          template: 'unknown',
          templateData: {},
          orgId: ORG_UUID,
        }),
      ).resolves.toBeUndefined();

      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'email.failed',
        }),
      );
    });

    it('handles DTO validation failure gracefully', async () => {
      await expect(
        service.sendTransactionalEmail({
          to: 'not-an-email',
          subject: 'Test',
          template: 'user-invite',
          templateData: {},
          orgId: ORG_UUID,
        }),
      ).resolves.toBeUndefined();

      expect(mockEmailProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('skips audit log when orgId is not provided', async () => {
      await service.sendTransactionalEmail({
        to: 'user@example.com',
        subject: 'Test',
        template: 'user-invite',
        templateData: { inviterName: 'Alice', orgName: 'Acme', inviteUrl: '' },
      });

      expect(mockActivityLog.logActivity).not.toHaveBeenCalled();
    });
  });
});
