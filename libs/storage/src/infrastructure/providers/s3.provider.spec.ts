import { Test, TestingModule } from '@nestjs/testing';
import { S3Provider } from './s3.provider';
import { S3StorageClient } from '../clients/s3.client';

describe('S3Provider', () => {
  let provider: S3Provider;
  let s3Client: jest.Mocked<S3StorageClient>;

  beforeEach(async () => {
    s3Client = {
      generatePresignedUploadUrl: jest.fn(),
      generatePresignedDownloadUrl: jest.fn(),
      deleteObject: jest.fn(),
      objectExists: jest.fn(),
    } as unknown as jest.Mocked<S3StorageClient>;

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

      const result = await provider.generateUploadUrl('test-key', 'application/pdf', 3600);

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
      expect(s3Client.generatePresignedDownloadUrl).toHaveBeenCalledWith('test-key', 3600);
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
});
