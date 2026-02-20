import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SubscriptionPlan } from '@prisma/client';
import { FileMetadataService } from './file-metadata.service';

/**
 * Storage Quota Service
 *
 * Validates upload permissions based on organization subscription plan
 * and current storage usage. This is a hook-ready service that can be
 * extended with plan-specific limits.
 */
@Injectable()
export class StorageQuotaService {
  private readonly logger = new Logger(StorageQuotaService.name);

  // Plan-based storage limits (in GB)
  private readonly STORAGE_LIMITS: Record<SubscriptionPlan, number | null> = {
    [SubscriptionPlan.FREE]: 1, // 1 GB
    [SubscriptionPlan.PRO]: 50, // 50 GB
    [SubscriptionPlan.ENTERPRISE]: null, // Unlimited
  };

  // Plan-based file count limits
  private readonly FILE_COUNT_LIMITS: Record<SubscriptionPlan, number | null> = {
    [SubscriptionPlan.FREE]: 100, // 100 files
    [SubscriptionPlan.PRO]: 10000, // 10,000 files
    [SubscriptionPlan.ENTERPRISE]: null, // Unlimited
  };

  // Maximum single file size (in GB)
  private readonly MAX_FILE_SIZE: Record<SubscriptionPlan, number> = {
    [SubscriptionPlan.FREE]: 0.1, // 100 MB
    [SubscriptionPlan.PRO]: 20, // 20 GB
    [SubscriptionPlan.ENTERPRISE]: 100, // 100 GB
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileMetadataService: FileMetadataService,
  ) {}

  /**
   * Validate if organization can upload a file
   * @throws ForbiddenException if quota exceeded
   */
  async validateUploadAllowed(orgId: string, fileSizeBytes: number): Promise<void> {
    this.logger.debug(`Validating upload quota for org ${orgId}, size: ${fileSizeBytes} bytes`);

    // Get organization subscription
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    const plan = subscription?.plan || SubscriptionPlan.FREE;

    // Check single file size limit
    await this.validateFileSizeLimit(plan, fileSizeBytes);

    // Check total storage limit
    await this.validateStorageLimit(orgId, plan, fileSizeBytes);

    // Check file count limit
    await this.validateFileCountLimit(orgId, plan);

    this.logger.debug(`Upload validation passed for org ${orgId}`);
  }

  /**
   * Validate single file size
   */
  private async validateFileSizeLimit(
    plan: SubscriptionPlan,
    fileSizeBytes: number,
  ): Promise<void> {
    const maxSizeGB = this.MAX_FILE_SIZE[plan];
    const maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;

    if (fileSizeBytes > maxSizeBytes) {
      throw new ForbiddenException(
        `File size exceeds plan limit. Maximum: ${maxSizeGB} GB for ${plan} plan`,
      );
    }
  }

  /**
   * Validate total storage limit
   */
  private async validateStorageLimit(
    orgId: string,
    plan: SubscriptionPlan,
    additionalSizeBytes: number,
  ): Promise<void> {
    const limitGB = this.STORAGE_LIMITS[plan];

    // Unlimited storage
    if (limitGB === null) {
      return;
    }

    const currentUsageBytes = await this.fileMetadataService.getTotalStorageByOrg(orgId);
    const limitBytes = BigInt(limitGB * 1024 * 1024 * 1024);
    const newTotalBytes = currentUsageBytes + BigInt(additionalSizeBytes);

    if (newTotalBytes > limitBytes) {
      const usedGB = Number(currentUsageBytes) / (1024 * 1024 * 1024);
      throw new ForbiddenException(
        `Storage quota exceeded. Used: ${usedGB.toFixed(2)} GB, Limit: ${limitGB} GB for ${plan} plan`,
      );
    }
  }

  /**
   * Validate file count limit
   */
  private async validateFileCountLimit(orgId: string, plan: SubscriptionPlan): Promise<void> {
    const fileCountLimit = this.FILE_COUNT_LIMITS[plan];

    // Unlimited files
    if (fileCountLimit === null) {
      return;
    }

    const currentCount = await this.fileMetadataService.getFileCountByOrg(orgId);

    if (currentCount >= fileCountLimit) {
      throw new ForbiddenException(
        `File count limit reached. Current: ${currentCount}, Limit: ${fileCountLimit} for ${plan} plan`,
      );
    }
  }

  /**
   * Get current quota usage for organization
   */
  async getQuotaUsage(orgId: string): Promise<{
    plan: SubscriptionPlan;
    storageUsedBytes: string;
    storageLimitBytes: string | null;
    fileCount: number;
    fileCountLimit: number | null;
    storagePercentage: number | null;
    fileCountPercentage: number | null;
  }> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    const plan = subscription?.plan || SubscriptionPlan.FREE;

    const storageUsedBytes = await this.fileMetadataService.getTotalStorageByOrg(orgId);
    const fileCount = await this.fileMetadataService.getFileCountByOrg(orgId);

    const storageLimitGB = this.STORAGE_LIMITS[plan];
    const storageLimitBytes = storageLimitGB ? BigInt(storageLimitGB * 1024 * 1024 * 1024) : null;

    const fileCountLimit = this.FILE_COUNT_LIMITS[plan];

    const storagePercentage =
      storageLimitBytes !== null
        ? Number((storageUsedBytes * BigInt(100)) / storageLimitBytes)
        : null;

    const fileCountPercentage = fileCountLimit !== null ? (fileCount / fileCountLimit) * 100 : null;

    return {
      plan,
      storageUsedBytes: storageUsedBytes.toString(),
      storageLimitBytes: storageLimitBytes?.toString() || null,
      fileCount,
      fileCountLimit,
      storagePercentage,
      fileCountPercentage,
    };
  }

  /**
   * Check if organization is approaching quota limits
   */
  async isApproachingQuota(orgId: string, thresholdPercentage: number = 80): Promise<boolean> {
    const usage = await this.getQuotaUsage(orgId);

    if (usage.storagePercentage !== null && usage.storagePercentage >= thresholdPercentage) {
      return true;
    }

    if (usage.fileCountPercentage !== null && usage.fileCountPercentage >= thresholdPercentage) {
      return true;
    }

    return false;
  }
}
