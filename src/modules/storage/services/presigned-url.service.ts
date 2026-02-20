import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StorageProvider } from '@prisma/client';
import { IStorageProvider } from '../providers/storage.provider.interface';
import { FileMetadataService } from './file-metadata.service';

/**
 * Presigned URL Service
 *
 * Generates presigned URLs for downloading files
 */
@Injectable()
export class PresignedUrlService {
  private readonly logger = new Logger(PresignedUrlService.name);
  private readonly providers: Map<StorageProvider, IStorageProvider> = new Map();
  private readonly defaultExpiresIn = 3600; // 1 hour

  constructor(private readonly fileMetadataService: FileMetadataService) {}

  /**
   * Register a storage provider
   */
  registerProvider(providerType: StorageProvider, provider: IStorageProvider): void {
    this.providers.set(providerType, provider);
    this.logger.log(`Registered storage provider: ${providerType}`);
  }

  /**
   * Get provider instance
   */
  private getProvider(providerType: StorageProvider): IStorageProvider {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new BadRequestException(`Storage provider not configured: ${providerType}`);
    }
    return provider;
  }

  /**
   * Generate presigned download URL for a file
   */
  async generateDownloadUrl(
    fileId: string,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<{ url: string; expiresIn: number }> {
    const file = await this.fileMetadataService.findByIdOrFail(fileId);

    if (file.deletedAt) {
      throw new BadRequestException('File has been deleted');
    }

    const provider = this.getProvider(file.storageProvider);

    this.logger.debug(`Generating download URL for file: ${file.id}`);

    const result = await provider.generatePresignedDownloadUrl(
      file.bucketOrContainer,
      file.storageKey,
      expiresIn,
    );

    return result;
  }

  /**
   * Generate presigned download URL by storage info (without file metadata lookup)
   */
  async generateDownloadUrlDirect(
    storageProvider: StorageProvider,
    bucketOrContainer: string,
    storageKey: string,
    expiresIn: number = this.defaultExpiresIn,
  ): Promise<{ url: string; expiresIn: number }> {
    const provider = this.getProvider(storageProvider);

    this.logger.debug(
      `Generating direct download URL for: ${storageProvider}/${bucketOrContainer}/${storageKey}`,
    );

    const result = await provider.generatePresignedDownloadUrl(
      bucketOrContainer,
      storageKey,
      expiresIn,
    );

    return result;
  }
}
