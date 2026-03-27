import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
} from './providers/email-provider.interface';
import { TemplateRendererService } from './templates/template-renderer.service';
import { Mocked, vi } from 'vitest';

describe('EmailService', () => {
  let service: EmailService;
  let emailProvider: Mocked<EmailProvider>;
  let templateRenderer: Mocked<TemplateRendererService>;
  let activityLog: Mocked<ActivityLogService>;
  let legalAudit: Mocked<LegalAuditService>;

  beforeEach(async () => {
    const mockEmailProvider: Mocked<EmailProvider> = {
      sendEmail: vi.fn().mockResolvedValue(undefined),
    };

    const mockTemplateRenderer = {
      render: vi.fn().mockResolvedValue('<html>Test Email</html>'),
      clearCache: vi.fn(),
    };

    const mockActivityLog = {
      logActivity: vi.fn().mockResolvedValue(undefined),
    };

    const mockLegalAudit = {
      recordEvent: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: EMAIL_PROVIDER,
          useValue: mockEmailProvider,
        },
        {
          provide: TemplateRendererService,
          useValue: mockTemplateRenderer,
        },
        {
          provide: ActivityLogService,
          useValue: mockActivityLog,
        },
        {
          provide: LegalAuditService,
          useValue: mockLegalAudit,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    emailProvider = module.get(EMAIL_PROVIDER);
    templateRenderer = module.get(TemplateRendererService);
    activityLog = module.get(ActivityLogService);
    legalAudit = module.get(LegalAuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendTransactionalEmail', () => {
    const validParams = {
      templateName: 'user-invite' as const,
      recipient: 'test@example.com',
      subject: 'Test Subject',
      data: { userName: 'Test User' },
      orgId: 'org-123',
      userId: 'user-456',
    };

    it('should send email successfully', async () => {
      await service.sendTransactionalEmail(validParams);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(templateRenderer.render).toHaveBeenCalledWith(
        'user-invite',
        validParams.data,
      );
      expect(emailProvider.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
          html: '<html>Test Email</html>',
        }),
      );
    });

    it('should validate recipient email', async () => {
      const invalidParams = {
        ...validParams,
        recipient: 'invalid-email',
      };

      await service.sendTransactionalEmail(invalidParams);

      // Should not call provider for invalid email
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emailProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('should reject empty recipient', async () => {
      const invalidParams = {
        ...validParams,
        recipient: '',
      };

      await service.sendTransactionalEmail(invalidParams);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emailProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('should reject empty subject', async () => {
      const invalidParams = {
        ...validParams,
        subject: '',
      };

      await service.sendTransactionalEmail(invalidParams);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(emailProvider.sendEmail).not.toHaveBeenCalled();
    });

    it('should log success to activity log', async () => {
      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-123',
          actorId: 'user-456',
          action: 'email.sent',
          entityType: 'email',
          metadata: expect.objectContaining({
            template: 'user-invite',
            recipient: 'test@example.com',
            status: 'sent',
          }),
        }),
      );
    });

    it('should log success to legal audit', async () => {
      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'email.sent',
          orgId: 'org-123',
          triggerType: 'system',
          metadata: expect.objectContaining({
            template: 'user-invite',
          }),
        }),
      );
    });

    it('should handle provider errors gracefully', async () => {
      emailProvider.sendEmail.mockRejectedValueOnce(
        new Error('Provider error'),
      );

      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should log failure
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'email.failed',
        }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'email.failed',
        }),
      );
    });

    it('should handle template rendering errors', async () => {
      templateRenderer.render.mockRejectedValueOnce(
        new Error('Template error'),
      );

      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not call provider
      expect(emailProvider.sendEmail).not.toHaveBeenCalled();

      // Should log failure
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'email.failed',
        }),
      );
    });

    it('should work without orgId', async () => {
      const paramsWithoutOrg = {
        templateName: 'user-invite' as const,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        data: { userName: 'Test User' },
      };

      await service.sendTransactionalEmail(paramsWithoutOrg);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(emailProvider.sendEmail).toHaveBeenCalled();
      // Activity log should not be called without orgId
      expect(activityLog.logActivity).not.toHaveBeenCalled();
      // Legal audit should still be called
      expect(legalAudit.recordEvent).toHaveBeenCalled();
    });

    it('should handle activity log failures gracefully', async () => {
      activityLog.logActivity.mockImplementationOnce(() => {
        throw new Error('Activity log error');
      });

      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Email should still be sent
      expect(emailProvider.sendEmail).toHaveBeenCalled();
    });

    it('should handle legal audit failures gracefully', async () => {
      legalAudit.recordEvent.mockImplementationOnce(() => {
        throw new Error('Legal audit error');
      });

      await service.sendTransactionalEmail(validParams);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Email should still be sent
      expect(emailProvider.sendEmail).toHaveBeenCalled();
    });
  });

  describe('email validation', () => {
    const validEmails = [
      'user@example.com',
      'test.user@example.com',
      'user+tag@example.co.uk',
      'user_name@example-domain.com',
    ];

    const invalidEmails = [
      'not-an-email',
      '@example.com',
      'user@',
      'user @example.com',
      'user@example',
    ];

    validEmails.forEach((email) => {
      it(`should accept valid email: ${email}`, async () => {
        await service.sendTransactionalEmail({
          templateName: 'user-invite',
          recipient: email,
          subject: 'Test',
          data: {},
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(emailProvider.sendEmail).toHaveBeenCalled();
      });
    });

    invalidEmails.forEach((email) => {
      it(`should reject invalid email: ${email}`, async () => {
        emailProvider.sendEmail.mockClear();

        await service.sendTransactionalEmail({
          templateName: 'user-invite',
          recipient: email,
          subject: 'Test',
          data: {},
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(emailProvider.sendEmail).not.toHaveBeenCalled();
      });
    });
  });
});
