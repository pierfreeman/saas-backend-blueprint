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
      const mockSend = vi
        .fn()
        .mockRejectedValue(new Error('S3 delete failed'));
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
});
