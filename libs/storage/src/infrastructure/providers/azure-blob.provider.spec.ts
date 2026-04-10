import { Test, TestingModule } from '@nestjs/testing';
import { AzureBlobProvider } from './azure-blob.provider';
import { AzureBlobStorageClient } from '../clients/azure-blob.client';
import { Mocked, vi } from 'vitest';

describe('AzureBlobProvider', () => {
  let provider: AzureBlobProvider;
  let azureClient: Mocked<AzureBlobStorageClient>;

  beforeEach(async () => {
    azureClient = {
      generatePresignedUploadUrl: vi.fn(),
      generatePresignedDownloadUrl: vi.fn(),
      deleteObject: vi.fn(),
      objectExists: vi.fn(),
      getObjectSize: vi.fn(),
      putObject: vi.fn(),
    } as unknown as Mocked<AzureBlobStorageClient>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AzureBlobProvider,
        { provide: AzureBlobStorageClient, useValue: azureClient },
      ],
    }).compile();

    provider = module.get<AzureBlobProvider>(AzureBlobProvider);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  describe('generateUploadUrl', () => {
    it('delegates to azureClient.generatePresignedUploadUrl', async () => {
      const mockUrl =
        'https://devstoreaccount1.blob.core.windows.net/saas-storage/key?sv=...';
      azureClient.generatePresignedUploadUrl.mockResolvedValue(mockUrl);

      const result = await provider.generateUploadUrl(
        'org/org-1/file.pdf',
        'application/pdf',
        3600,
      );

      expect(result).toBe(mockUrl);
      expect(azureClient.generatePresignedUploadUrl).toHaveBeenCalledWith(
        'org/org-1/file.pdf',
        'application/pdf',
        3600,
      );
    });
  });

  describe('generateDownloadUrl', () => {
    it('delegates to azureClient.generatePresignedDownloadUrl', async () => {
      const mockUrl =
        'https://devstoreaccount1.blob.core.windows.net/saas-storage/key?sv=...';
      azureClient.generatePresignedDownloadUrl.mockResolvedValue(mockUrl);

      const result = await provider.generateDownloadUrl(
        'org/org-1/file.pdf',
        3600,
      );

      expect(result).toBe(mockUrl);
      expect(azureClient.generatePresignedDownloadUrl).toHaveBeenCalledWith(
        'org/org-1/file.pdf',
        3600,
      );
    });
  });

  describe('deleteObject', () => {
    it('delegates to azureClient.deleteObject', async () => {
      azureClient.deleteObject.mockResolvedValue(undefined);

      await provider.deleteObject('org/org-1/file.pdf');

      expect(azureClient.deleteObject).toHaveBeenCalledWith(
        'org/org-1/file.pdf',
      );
    });
  });

  describe('objectExists', () => {
    it('returns true when blob exists', async () => {
      azureClient.objectExists.mockResolvedValue(true);

      const result = await provider.objectExists('org/org-1/file.pdf');

      expect(result).toBe(true);
      expect(azureClient.objectExists).toHaveBeenCalledWith(
        'org/org-1/file.pdf',
      );
    });

    it('returns false when blob does not exist', async () => {
      azureClient.objectExists.mockResolvedValue(false);

      const result = await provider.objectExists('org/org-1/file.pdf');

      expect(result).toBe(false);
    });
  });

  describe('getObjectSize', () => {
    it('delegates to azureClient.getObjectSize and returns bigint', async () => {
      azureClient.getObjectSize.mockResolvedValue(BigInt(4096));

      const result = await provider.getObjectSize('org/org-1/file.pdf');

      expect(result).toBe(BigInt(4096));
      expect(azureClient.getObjectSize).toHaveBeenCalledWith(
        'org/org-1/file.pdf',
      );
    });
  });

  describe('putObject', () => {
    it('delegates to azureClient.putObject with all arguments', async () => {
      azureClient.putObject.mockResolvedValue(undefined);
      const buffer = Buffer.from('hello world');

      await provider.putObject(
        'org/org-1/export.gz',
        buffer,
        'application/gzip',
      );

      expect(azureClient.putObject).toHaveBeenCalledWith(
        'org/org-1/export.gz',
        buffer,
        'application/gzip',
      );
    });
  });
});
