import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3StorageClient } from './s3.client';
import { Mock, Mocked, vi } from 'vitest';

describe('S3StorageClient', () => {
  let client: S3StorageClient;
  let configService: Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: vi.fn(),
    } as unknown as Mocked<ConfigService>;

    // Mock S3 config
    configService.get.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        'storage.s3': {
          region: 'us-east-1',
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          bucket: 'test-bucket',
          endpoint: 'http://localhost:4566',
        },
      };
      return config[key];
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3StorageClient,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    client = module.get<S3StorageClient>(S3StorageClient);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  it('should initialize with correct bucket', () => {
    expect(client.getBucket()).toBe('test-bucket');
  });

  it('initializes without custom endpoint (else branch — line 49)', async () => {
    const configWithoutEndpoint = {
      get: vi.fn().mockReturnValue({
        region: 'us-east-1',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        bucket: 'test-bucket',
        // no endpoint → skips forcePathStyle block
      }),
    } as unknown as Mocked<ConfigService>;

    const mod = await Test.createTestingModule({
      providers: [
        S3StorageClient,
        { provide: ConfigService, useValue: configWithoutEndpoint },
      ],
    }).compile();

    const c = mod.get<S3StorageClient>(S3StorageClient);
    expect(c.getBucket()).toBe('test-bucket');
  });

  it('should generate presigned upload URL', async () => {
    const url = await client.generatePresignedUploadUrl(
      'org/test-org/test-file',
      'application/pdf',
      3600,
    );
    expect(url).toBeDefined();
    expect(url).toContain('test-bucket');
    expect(url).toContain('X-Amz-Signature');
  });

  it('should generate presigned download URL', async () => {
    const url = await client.generatePresignedDownloadUrl(
      'org/test-org/test-file',
      3600,
    );
    expect(url).toBeDefined();
    expect(url).toContain('test-bucket');
    expect(url).toContain('X-Amz-Signature');
  });

  // ── deleteObject ──────────────────────────────────────────────────────────

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand and resolves', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
      };

      await expect(
        client.deleteObject('org/test-org/file-1'),
      ).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from S3', async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error('S3 delete failed'));
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
      };

      await expect(client.deleteObject('org/test-org/file-1')).rejects.toThrow(
        'S3 delete failed',
      );
    });
  });

  // ── objectExists ──────────────────────────────────────────────────────────

  describe('objectExists', () => {
    it('returns true when HeadObject succeeds', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
      };

      const result = await client.objectExists('org/test-org/file-1');
      expect(result).toBe(true);
    });

    it('returns false when error.name is NotFound', async () => {
      const notFound = Object.assign(new Error('Not Found'), {
        name: 'NotFound',
      });
      const mockSend = vi.fn().mockRejectedValue(notFound);
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
      };

      const result = await client.objectExists('org/test-org/missing-file');
      expect(result).toBe(false);
    });

    it('rethrows errors that are not NotFound', async () => {
      const accessDenied = Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
      });
      const mockSend = vi.fn().mockRejectedValue(accessDenied);
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
      };

      await expect(client.objectExists('org/test-org/file-1')).rejects.toThrow(
        'Access Denied',
      );
    });
  });

  // ── getObjectSize ─────────────────────────────────────────────────────────

  describe('getObjectSize', () => {
    it('returns BigInt of ContentLength when present', async () => {
      const mockSend = vi.fn().mockResolvedValue({ ContentLength: 1024 });
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      const size = await client.getObjectSize('org/test-org/file-1');
      expect(size).toBe(BigInt(1024));
    });

    it('returns BigInt(0) when ContentLength is undefined (?? 0 branch)', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      const size = await client.getObjectSize('org/test-org/file-1');
      expect(size).toBe(BigInt(0));
    });

    it('propagates errors from S3', async () => {
      const mockSend = vi
        .fn()
        .mockRejectedValue(new Error('HeadObject failed'));
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      await expect(client.getObjectSize('org/test-org/file-1')).rejects.toThrow(
        'HeadObject failed',
      );
    });
  });

  // ── putObject ─────────────────────────────────────────────────────────────

  describe('putObject', () => {
    it('uploads a buffer and resolves', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      await expect(
        client.putObject(
          'org/test-org/file-1',
          Buffer.from('hello'),
          'text/plain',
        ),
      ).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('uses default contentType when not specified', async () => {
      const mockSend = vi.fn().mockResolvedValue({});
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      await client.putObject('org/test-org/file-1', Buffer.from('data'));
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from S3', async () => {
      const mockSend = vi.fn().mockRejectedValue(new Error('PutObject failed'));
      (client as unknown as Record<string, unknown>)['client'] = {
        send: mockSend,
        config: {},
      };

      await expect(
        client.putObject('org/test-org/file-1', Buffer.from('data')),
      ).rejects.toThrow('PutObject failed');
    });
  });

  // ── rewritePublicEndpoint ─────────────────────────────────────────────────

  describe('rewritePublicEndpoint (private)', () => {
    it('rewrites origin to publicEndpoint when both are set', () => {
      (client as unknown as Record<string, unknown>)['publicEndpoint'] =
        'http://localhost:4566';
      (client as unknown as Record<string, unknown>)['client'] = {
        config: { endpoint: 'http://localstack:4566' },
        send: vi.fn(),
      };

      const rewritten = (client as any).rewritePublicEndpoint(
        'http://localstack:4566/test-bucket/key?X-Amz-Signature=abc',
      );

      expect(rewritten).toContain('localhost');
      expect(rewritten).not.toContain('localstack');
    });

    it('returns original URL untouched when publicEndpoint is not set', () => {
      (client as unknown as Record<string, unknown>)['publicEndpoint'] =
        undefined;

      const url = 'http://localstack:4566/bucket/key';
      const result = (client as any).rewritePublicEndpoint(url);
      expect(result).toBe(url);
    });

    it('returns original URL when parsing throws (catch branch)', () => {
      (client as unknown as Record<string, unknown>)['publicEndpoint'] =
        'http://localhost:4566';
      (client as unknown as Record<string, unknown>)['client'] = {
        config: { endpoint: 'http://localstack:4566' },
        send: vi.fn(),
      };

      // Pass an invalid URL to trigger the catch block
      const result = (client as any).rewritePublicEndpoint('not-a-valid-url');
      expect(result).toBe('not-a-valid-url');
    });
  });
});
