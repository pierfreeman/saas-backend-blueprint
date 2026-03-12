import { Test, TestingModule } from '@nestjs/testing';
import { SendGridProvider } from '../../lib/providers/sendgrid.provider';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn(),
}));

function buildConfigService(apiKey = 'SG.test-key') {
  return {
    get: jest.fn((key: string) => {
      const config: Record<string, unknown> = {
        'email.sendgrid': { apiKey },
        'email.from.address': 'noreply@test.com',
        'email.from.name': 'Test Platform',
      };
      return config[key];
    }),
  };
}

describe('SendGridProvider', () => {
  let provider: SendGridProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendGridProvider,
        { provide: ConfigService, useValue: buildConfigService() },
      ],
    }).compile();

    provider = module.get<SendGridProvider>(SendGridProvider);
    provider.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('initializes SendGrid with the API key from config', () => {
      expect(sgMail.setApiKey).toHaveBeenCalledWith('SG.test-key');
    });

    it('logs a warning and skips setApiKey when API key is empty', async () => {
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          SendGridProvider,
          { provide: ConfigService, useValue: buildConfigService('') },
        ],
      }).compile();

      const provider2 = module2.get<SendGridProvider>(SendGridProvider);
      const warnSpy = jest
        .spyOn(provider2['logger'], 'warn')
        .mockImplementation(() => undefined);

      provider2.onModuleInit();

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('sendEmail', () => {
    it('calls sgMail.send with correct parameters', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await provider.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        text: 'Hello',
      });

      expect(sgMail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
          text: 'Hello',
          from: { email: 'noreply@test.com', name: 'Test Platform' },
        }),
      );
    });

    it('calls sgMail.send without text when text is not provided', async () => {
      (sgMail.send as jest.Mock).mockResolvedValueOnce([{ statusCode: 202 }]);

      await provider.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(sgMail.send).toHaveBeenCalledTimes(1);
      const callArg = (sgMail.send as jest.Mock).mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(callArg['text']).toBeUndefined();
    });

    it('throws when sgMail.send rejects', async () => {
      (sgMail.send as jest.Mock).mockRejectedValueOnce(
        new Error('SendGrid API error'),
      );

      await expect(
        provider.sendEmail({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        }),
      ).rejects.toThrow('SendGrid delivery failed: SendGrid API error');
    });

    it('skips send and logs a warning when API key is not set', async () => {
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          SendGridProvider,
          { provide: ConfigService, useValue: buildConfigService('') },
        ],
      }).compile();

      const provider2 = module2.get<SendGridProvider>(SendGridProvider);
      provider2.onModuleInit();

      const warnSpy = jest
        .spyOn(provider2['logger'], 'warn')
        .mockImplementation(() => undefined);

      await provider2.sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(sgMail.send).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
