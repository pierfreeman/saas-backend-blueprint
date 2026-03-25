import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageConfig } from '@libs/config';
import { UploadPolicy, StorageQuota, PlanType } from '../../domain/types';
import { StorageRepository } from '../../infrastructure/repositories/storage.repository';

/**
 * Service for validating upload requests against organization policies.
 * Enforces file size limits, MIME type restrictions, and storage quotas.
 */
@Injectable()
export class UploadPolicyService {
  private readonly logger = new Logger(UploadPolicyService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly storageRepository: StorageRepository,
  ) {}

  /**
   * Get the upload policy for an organization based on their plan.
   */
  getUploadPolicy(planType: PlanType): UploadPolicy {
    const quotas =
      this.configService.get<StorageConfig['quotas']>('storage.quotas')!;

    let maxFileSizeGb: number;
    switch (planType) {
      case 'free':
        maxFileSizeGb = quotas.freePlan.maxFileSizeGb ?? 0.1;
        break;
      case 'pro':
        maxFileSizeGb = quotas.proPlan.maxFileSizeGb ?? 20;
        break;
      case 'enterprise':
        maxFileSizeGb = quotas.enterprisePlan.maxFileSizeGb ?? 100;
        break;
    }

    return {
      maxFileSizeBytes: maxFileSizeGb * 1024 * 1024 * 1024,
    };
  }

  /**
   * Get storage quota information for an organization.
   */
  async getStorageQuota(
    orgId: string,
    planType: PlanType,
    orgStorageLimit?: bigint | null,
  ): Promise<StorageQuota> {
    const quotas =
      this.configService.get<StorageConfig['quotas']>('storage.quotas')!;
    const usage = await this.storageRepository.getStorageUsage(orgId);

    let storageLimitGb: number | undefined;
    let fileCountLimit: number | undefined;
    let maxFileSizeGb: number;

    switch (planType) {
      case 'free':
        storageLimitGb = quotas.freePlan.storageLimitGb;
        fileCountLimit = quotas.freePlan.fileCountLimit;
        maxFileSizeGb = quotas.freePlan.maxFileSizeGb ?? 0.1;
        break;
      case 'pro':
        storageLimitGb = quotas.proPlan.storageLimitGb;
        fileCountLimit = quotas.proPlan.fileCountLimit;
        maxFileSizeGb = quotas.proPlan.maxFileSizeGb ?? 20;
        break;
      case 'enterprise':
        storageLimitGb = quotas.enterprisePlan.storageLimitGb;
        fileCountLimit = quotas.enterprisePlan.fileCountLimit;
        maxFileSizeGb = quotas.enterprisePlan.maxFileSizeGb ?? 100;
        break;
    }

    // Org-specific limit overrides plan default
    let storageLimitBytes: bigint | null = null;
    if (orgStorageLimit !== undefined && orgStorageLimit !== null) {
      storageLimitBytes = orgStorageLimit;
    } else if (storageLimitGb !== undefined) {
      storageLimitBytes = BigInt(
        Math.round(storageLimitGb * 1024 * 1024 * 1024),
      );
    }

    return {
      storageLimitBytes,
      storageUsedBytes: usage.totalBytes,
      fileCount: usage.fileCount,
      fileCountLimit: fileCountLimit ?? null,
      maxFileSizeBytes: maxFileSizeGb * 1024 * 1024 * 1024,
    };
  }

  /**
   * Validate an upload request against the organization's policy.
   * Throws BadRequestException or ForbiddenException on validation failure.
   */
  async validateUploadRequest(
    orgId: string,
    filename: string,
    mimeType: string,
    sizeBytes: number,
    planType: PlanType,
    orgStorageLimit?: bigint | null,
  ): Promise<void> {
    // Validate file size
    const policy = this.getUploadPolicy(planType);
    if (sizeBytes > policy.maxFileSizeBytes) {
      throw new BadRequestException(
        `File size (${this.formatBytes(sizeBytes)}) exceeds maximum allowed (${this.formatBytes(policy.maxFileSizeBytes)})`,
      );
    }

    // Validate MIME type if restricted
    if (policy.allowedMimeTypes && policy.allowedMimeTypes.length > 0) {
      if (!policy.allowedMimeTypes.includes(mimeType)) {
        throw new BadRequestException(`MIME type '${mimeType}' is not allowed`);
      }
    }

    if (policy.forbiddenMimeTypes && policy.forbiddenMimeTypes.length > 0) {
      if (policy.forbiddenMimeTypes.includes(mimeType)) {
        throw new BadRequestException(`MIME type '${mimeType}' is forbidden`);
      }
    }

    // Validate storage quota
    const quota = await this.getStorageQuota(orgId, planType, orgStorageLimit);

    // Check file count limit
    if (
      quota.fileCountLimit !== null &&
      quota.fileCount >= quota.fileCountLimit
    ) {
      throw new ForbiddenException(
        `File count limit (${quota.fileCountLimit}) reached`,
      );
    }

    // Check storage limit
    if (quota.storageLimitBytes !== null) {
      const projectedUsage = quota.storageUsedBytes + BigInt(sizeBytes);
      if (projectedUsage > quota.storageLimitBytes) {
        throw new ForbiddenException(
          `Storage quota (${this.formatBytes(Number(quota.storageLimitBytes))}) would be exceeded`,
        );
      }
    }

    this.logger.debug(
      `Upload validation passed: ${filename}, ${this.formatBytes(sizeBytes)}`,
    );
  }

  /**
   * Format bytes to human-readable string.
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}
