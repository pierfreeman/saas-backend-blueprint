import { Test, TestingModule } from '@nestjs/testing';
import { S3Provider } from './s3.provider';
import { S3StorageClient } from '../clients/s3.client';
import { Mocked, vi } from 'vitest';

describe('S3Provider', () => {
  let provider: S3Provider;
  let s3Client: Mocked<S3StorageClient>;

  beforeEach(async () => {
    s3Client = {
      generatePresignedUploadUrl: vi.fn(),
      generatePresignedDownloadUrl: vi.fn(),
      deleteObject: vi.fn(),
      objectExists: vi.fn(),
      getObjectSize: vi.fn(),
    } as unknown as Mocked<S3StorageClient>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [S3Provider, { provide: S3StorageClient, useValue: s3Client }],
    }).compile();

    provider = module.get<S3Provider>(S3Provider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('generateUploadUrl', () => {
    it('should generate presigned upload URL', async () => {
      const mockUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      s3Client.generatePresignedUploadUrl.mockResolvedValue(mockUrl);

      const result = await provider.generateUploadUrl(
        'test-key',
        'application/pdf',
        3600,
      );

      expect(result).toBe(mockUrl);
      expect(s3Client.generatePresignedUploadUrl).toHaveBeenCalledWith(
        'test-key',
        'application/pdf',
        3600,
      );
    });
  });

  describe('generateDownloadUrl', () => {
    it('should generate presigned download URL', async () => {
      const mockUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      s3Client.generatePresignedDownloadUrl.mockResolvedValue(mockUrl);

      const result = await provider.generateDownloadUrl('test-key', 3600);

      expect(result).toBe(mockUrl);
      expect(s3Client.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'test-key',
        3600,
      );
    });
  });

  describe('deleteObject', () => {
    it('should delete object from S3', async () => {
      s3Client.deleteObject.mockResolvedValue(undefined);

      await provider.deleteObject('test-key');

      expect(s3Client.deleteObject).toHaveBeenCalledWith('test-key');
    });
  });

  describe('objectExists', () => {
    it('should return true when object exists', async () => {
      s3Client.objectExists.mockResolvedValue(true);

      const result = await provider.objectExists('test-key');

      expect(result).toBe(true);
      expect(s3Client.objectExists).toHaveBeenCalledWith('test-key');
    });

    it('should return false when object does not exist', async () => {
      s3Client.objectExists.mockResolvedValue(false);

      const result = await provider.objectExists('test-key');

      expect(result).toBe(false);
    });
  });

  describe('getObjectSize', () => {
    it('should return the object size from s3Client', async () => {
      s3Client.getObjectSize.mockResolvedValue(BigInt(12582912));

      const result = await provider.getObjectSize('test-key');

      expect(result).toBe(BigInt(12582912));
      expect(s3Client.getObjectSize).toHaveBeenCalledWith('test-key');
    });
  });
});
