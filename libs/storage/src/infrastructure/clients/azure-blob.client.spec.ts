import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AzureBlobStorageClient } from './azure-blob.client';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
import { Mocked, vi } from 'vitest';

// Shared mock helpers ─────────────────────────────────────────────────────────

const makeBlockBlobClientMock = () => ({
  url: 'http://devstoreaccount1.blob.core.windows.net/saas-storage/org/org-1/file-1',
  upload: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue({}),
  exists: vi.fn().mockResolvedValue(true),
  getProperties: vi.fn().mockResolvedValue({ contentLength: 1024 }),
});

const makeContainerClientMock = () => ({
  getBlockBlobClient: vi.fn().mockReturnValue(makeBlockBlobClientMock()),
});

const makeBlobServiceClientMock = () => ({
  getContainerClient: vi.fn().mockReturnValue(makeContainerClientMock()),
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AzureBlobStorageClient', () => {
  let client: AzureBlobStorageClient;
  let configService: Mocked<ConfigService>;
  let blobServiceClientMock: ReturnType<typeof makeBlobServiceClientMock>;
  let blockBlobClientMock: ReturnType<typeof makeBlockBlobClientMock>;

  beforeEach(async () => {
    blobServiceClientMock = makeBlobServiceClientMock();
    blockBlobClientMock = makeBlockBlobClientMock();

    blobServiceClientMock.getContainerClient.mockReturnValue(
      makeContainerClientMock(),
    );

    configService = {
      get: vi.fn(),
    } as unknown as Mocked<ConfigService>;

    configService.get.mockImplementation((key: string) => {
      const config: Record<string, unknown> = {
        'storage.azure': {
          storageAccount: 'devstoreaccount1',
          storageKey:
            'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGmAQ==',
          container: 'saas-storage',
          endpoint: 'http://azurite:10000/devstoreaccount1',
        },
      };
      return config[key];
    });

    // Spy on BlobServiceClient to replace with mock
    vi.spyOn(BlobServiceClient.prototype, 'getContainerClient').mockReturnValue(
      blobServiceClientMock.getContainerClient('saas-storage') as any,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AzureBlobStorageClient,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    client = module.get<AzureBlobStorageClient>(AzureBlobStorageClient);

    // Override the internal blockBlobClient returned within each method call
    blockBlobClientMock = makeBlockBlobClientMock();
    const containerClientMock = {
      getBlockBlobClient: vi.fn().mockReturnValue(blockBlobClientMock),
    };
    vi.spyOn(client['serviceClient'], 'getContainerClient').mockReturnValue(
      containerClientMock as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  it('returns the configured container name', () => {
    expect(client.getContainer()).toBe('saas-storage');
  });

  it('initializes with default Azure endpoint when no custom endpoint set', async () => {
    const configWithoutEndpoint = {
      get: vi.fn().mockReturnValue({
        storageAccount: 'myaccount',
        storageKey:
          'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGmAQ==',
        container: 'saas-storage',
        // no endpoint → uses default Azure URL
      }),
    } as unknown as Mocked<ConfigService>;

    const mod = await Test.createTestingModule({
      providers: [
        AzureBlobStorageClient,
        { provide: ConfigService, useValue: configWithoutEndpoint },
      ],
    }).compile();

    const c = mod.get<AzureBlobStorageClient>(AzureBlobStorageClient);
    expect(c.getContainer()).toBe('saas-storage');
  });

  // ── generatePresignedUploadUrl ────────────────────────────────────────────

  describe('generatePresignedUploadUrl', () => {
    it('returns a SAS URL containing the blob key', async () => {
      blockBlobClientMock.url =
        'http://azurite:10000/devstoreaccount1/saas-storage/org/org-1/file-1';

      // Mock generateBlobSASQueryParameters to return a predictable token
      const { generateBlobSASQueryParameters } =
        await import('@azure/storage-blob');
      vi.spyOn(
        { generateBlobSASQueryParameters },
        'generateBlobSASQueryParameters',
      ).mockReturnValue({
        toString: () => 'sv=2021-06-08&se=2026-01-01T01%3A00%3A00Z&sig=fakesig',
      } as any);

      const url = await client.generatePresignedUploadUrl(
        'org/org-1/file-1',
        'application/pdf',
        3600,
      );
      // URL must start with the blob URL and contain a SAS token
      expect(url).toContain('org/org-1/file-1');
      expect(url).toContain('?');
    });

    it('uses "cw" (create+write) permissions for upload', async () => {
      const parseSpy = vi.spyOn(
        (await import('@azure/storage-blob')).BlobSASPermissions,
        'parse',
      );
      await client.generatePresignedUploadUrl('key', 'image/png', 3600);
      expect(parseSpy).toHaveBeenCalledWith('cw');
    });
  });

  // ── generatePresignedDownloadUrl ──────────────────────────────────────────

  describe('generatePresignedDownloadUrl', () => {
    it('uses "r" (read) permissions for download', async () => {
      const parseSpy = vi.spyOn(
        (await import('@azure/storage-blob')).BlobSASPermissions,
        'parse',
      );
      await client.generatePresignedDownloadUrl('key', 3600);
      expect(parseSpy).toHaveBeenCalledWith('r');
    });
  });

  // ── deleteObject ──────────────────────────────────────────────────────────

  describe('deleteObject', () => {
    it('calls delete() on the BlockBlobClient', async () => {
      await client.deleteObject('org/org-1/file-1');
      expect(blockBlobClientMock.delete).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from the SDK', async () => {
      blockBlobClientMock.delete.mockRejectedValue(
        new Error('Blob delete failed'),
      );
      await expect(client.deleteObject('org/org-1/file-1')).rejects.toThrow(
        'Blob delete failed',
      );
    });
  });

  // ── objectExists ──────────────────────────────────────────────────────────

  describe('objectExists', () => {
    it('returns true when blob exists', async () => {
      blockBlobClientMock.exists.mockResolvedValue(true);
      const result = await client.objectExists('org/org-1/file-1');
      expect(result).toBe(true);
    });

    it('returns false when blob does not exist', async () => {
      blockBlobClientMock.exists.mockResolvedValue(false);
      const result = await client.objectExists('org/org-1/file-1');
      expect(result).toBe(false);
    });
  });

  // ── getObjectSize ─────────────────────────────────────────────────────────

  describe('getObjectSize', () => {
    it('returns size as bigint from contentLength', async () => {
      blockBlobClientMock.getProperties.mockResolvedValue({
        contentLength: 2048,
      });
      const size = await client.getObjectSize('org/org-1/file-1');
      expect(size).toBe(BigInt(2048));
    });

    it('returns 0n when contentLength is undefined', async () => {
      blockBlobClientMock.getProperties.mockResolvedValue({
        contentLength: undefined,
      });
      const size = await client.getObjectSize('org/org-1/file-1');
      expect(size).toBe(BigInt(0));
    });
  });

  // ── putObject ─────────────────────────────────────────────────────────────

  describe('putObject', () => {
    it('uploads a buffer with correct contentType header', async () => {
      const buffer = Buffer.from('test data');
      await client.putObject('org/org-1/export.gz', buffer, 'application/gzip');
      expect(blockBlobClientMock.upload).toHaveBeenCalledWith(
        buffer,
        buffer.length,
        { blobHTTPHeaders: { blobContentType: 'application/gzip' } },
      );
    });

    it('uses application/octet-stream as default contentType', async () => {
      const buffer = Buffer.from('raw');
      await client.putObject('org/org-1/data', buffer);
      expect(blockBlobClientMock.upload).toHaveBeenCalledWith(
        buffer,
        buffer.length,
        { blobHTTPHeaders: { blobContentType: 'application/octet-stream' } },
      );
    });

    it('propagates upload errors from the SDK', async () => {
      blockBlobClientMock.upload.mockRejectedValue(
        new Error('Container not found'),
      );
      await expect(
        client.putObject('key', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow('Container not found');
    });
  });
});
