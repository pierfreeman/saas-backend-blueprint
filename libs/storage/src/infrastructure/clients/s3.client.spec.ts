import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3StorageClient } from './s3.client';

describe('S3StorageClient', () => {
  let client: S3StorageClient;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

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
      providers: [S3StorageClient, { provide: ConfigService, useValue: configService }],
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
    const url = await client.generatePresignedDownloadUrl('org/test-org/test-file', 3600);
    expect(url).toBeDefined();
    expect(url).toContain('test-bucket');
    expect(url).toContain('X-Amz-Signature');
  });
});
