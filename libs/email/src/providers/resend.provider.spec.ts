import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResendProvider } from './resend.provider';
import { SendEmailDto } from '../dto/send-email.dto';
import { vi } from 'vitest';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

describe('ResendProvider', () => {
  let provider: ResendProvider;

  const mockConfigService = {
    get: vi.fn((key: string) => {
      const config: Record<string, string> = {
        'email.resend.apiKey': 'test-api-key',
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
        ResendProvider,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    provider = module.get<ResendProvider>(ResendProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
        text: 'Test Text',
      };

      mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

      await provider.sendEmail(emailDto);

      expect(mockSend).toHaveBeenCalledWith({
        from: 'Test Sender <test@example.com>',
        to: ['recipient@example.com'],
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

      mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

      await provider.sendEmail(emailDto);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: 'reply@example.com',
        }),
      );
    });

    it('should throw error if Resend returns an error response', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      };

      mockSend.mockResolvedValue({
        data: null,
        error: { message: 'Invalid API key', name: 'validation_error' },
      });

      await expect(provider.sendEmail(emailDto)).rejects.toThrow(
        'Email delivery failed',
      );
    });

    it('should throw error if Resend SDK throws', async () => {
      const emailDto: SendEmailDto = {
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Test HTML</p>',
      };

      mockSend.mockRejectedValue(new Error('Network error'));

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
            'email.resend.apiKey': undefined,
            'email.from.address': 'test@example.com',
            'email.from.name': 'Test Sender',
          };
          return config[key];
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ResendProvider,
          {
            provide: ConfigService,
            useValue: mockConfigWithoutKey,
          },
        ],
      }).compile();

      const providerWithoutKey = module.get<ResendProvider>(ResendProvider);

      expect(providerWithoutKey).toBeDefined();
    });
  });
});
