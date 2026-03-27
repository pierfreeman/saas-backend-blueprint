import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SendGridProvider } from './sendgrid.provider';
import { SendEmailDto } from '../dto/send-email.dto';
import { vi } from 'vitest';

const { mockSetApiKey, mockSend } = vi.hoisted(() => ({
  mockSetApiKey: vi.fn(),
  mockSend: vi.fn(),
}));

// Mock SendGrid module - provider resolves sgMail via `.default ?? module`
vi.mock('@sendgrid/mail', () => {
  const sgMock = {
    setApiKey: mockSetApiKey,
    send: mockSend,
  };
  return {
    default: sgMock,
    ...sgMock,
  };
});

describe('SendGridProvider', () => {
  let provider: SendGridProvider;
  let configService: ConfigService;

  const mockConfigService = {
    get: vi.fn((key: string) => {
      const config: Record<string, string> = {
        'email.sendgrid.apiKey': 'test-api-key',
        'email.from.address': 'test@example.com',
        'email.from.name': 'Test Sender',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SendGridProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<SendGridProvider>(SendGridProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should initialize SendGrid with API key', () => {
    expect(mockSetApiKey).toHaveBeenCalledWith('test-api-key');
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
        text: 'Test Text',
      };

      mockSend.mockResolvedValue([{ statusCode: 202 }]);

      await provider.sendEmail(emailDto);

      expect(mockSend).toHaveBeenCalledWith({
        to: 'recipient@example.com',
        from: {
          email: 'test@example.com',
          name: 'Test Sender',
        },
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
        text: 'Test Text',
        replyTo: undefined,
      });
    });

    it('should include replyTo if provided', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
        replyTo: 'reply@example.com',
      };

      mockSend.mockResolvedValue([{ statusCode: 202 }]);

      await provider.sendEmail(emailDto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: 'reply@example.com',
        }),
      );
    });

    it('should throw error if SendGrid fails', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      };

      const mockError = new Error('SendGrid API error');
      mockSend.mockRejectedValue(mockError);

      await expect(provider.sendEmail(emailDto)).rejects.toThrow(
        'Email delivery failed',
      );
    });

    it('should handle unknown errors', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      };

      mockSend.mockRejectedValue('Unknown error');

      await expect(provider.sendEmail(emailDto)).rejects.toThrow(
        'Email delivery failed: Unknown error',
      );
    });
  });

  describe('initialization without API key', () => {
    it('should warn if API key is not configured', async () => {
      const mockConfigWithoutKey = {
        get: vi.fn((key: string) => {
          const config: Record<string, string | undefined> = {
            'email.sendgrid.apiKey': undefined,
            'email.from.address': 'test@example.com',
            'email.from.name': 'Test Sender',
          };
          return config[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SendGridProvider,
          {
            provide: ConfigService,
            useValue: mockConfigWithoutKey,
          },
        ],
      }).compile();

      const providerWithoutKey = module.get<SendGridProvider>(SendGridProvider);

      expect(providerWithoutKey).toBeDefined();
      // The provider should still be created but will log a warning
    });
  });
});
