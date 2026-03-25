import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ExecutionContext,
  createParamDecorator,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { StorageService, UploadPolicyService } from '@libs/storage';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard, OrgScoped, RequireRole } from '@libs/rbac';
import { FeatureFlagsService } from '@libs/feature-flags';
import { BillingService } from '@libs/billing';
import type { PlanType } from '@libs/storage';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { ConfirmUploadResponseDto } from './dto/confirm-upload-response.dto';
import { DownloadUrlResponseDto } from './dto/download-url-response.dto';
import { FileMetadataResponseDto } from './dto/file-metadata-response.dto';
import { StorageQuotaResponseDto } from './dto/storage-quota-response.dto';

/**
 * Extracts the resolved DB user UUID (set on request.user.dbUserId by OrgContextGuard).
 */
const CurrentDbUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { dbUserId?: string } }>();
    return request.user?.dbUserId;
  },
);

/**
 * Extracts the resolved organization ID (set on request.orgId by OrgContextGuard).
 */
const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ orgId?: string }>();
    return request.orgId;
  },
);

/**
 * StorageController
 * HTTP endpoints for file storage operations.
 *
 * All routes require:
 *   1. JwtAuthGuard    — validates the Bearer JWT
 *   2. OrgContextGuard — resolves the organization and verifies active membership
 *   3. RBACGuard       — enforces role-based access control
 *
 * @route POST   /files/upload-url — Generate presigned upload URL
 * @route POST   /files/confirm    — Confirm file upload completion
 * @route GET    /files/quota      — Get storage quota and usage
 * @route GET    /files/:id/download — Generate presigned download URL
 * @route GET    /files/:id        — Get file metadata
 * @route GET    /files            — List organization files
 * @route DELETE /files/:id        — Delete a file
 */
@ApiTags('Storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@OrgScoped()
@Controller('files')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly uploadPolicyService: UploadPolicyService,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly billingService: BillingService,
  ) {}

  // ─── POST /files/upload-url ─────────────────────────────────────────────────

  @Post('upload-url')
  @HttpCode(HttpStatus.CREATED)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
  )
  @ApiOperation({
    summary: 'Generate a presigned upload URL',
    description:
      'Creates a file metadata record and returns a presigned URL for uploading the file directly to S3. ' +
      'The client must upload the file to the returned URL, then call the confirm endpoint.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Upload URL generated successfully.',
    type: UploadUrlResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — invalid file size or MIME type.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Storage quota exceeded or file count limit reached.',
  })
  async generateUploadUrl(
    @Body() dto: GenerateUploadUrlDto,
    @CurrentOrgId() orgId: string,
    @CurrentDbUserId() userId: string,
  ): Promise<UploadUrlResponseDto> {
    const { planType, orgStorageLimit } = await this.#resolveOrgPlan(orgId);

    const result = await this.storageService.generateUploadUrl(
      {
        orgId,
        userId,
        filename: dto.filename,
        mimeType: dto.mimeType,
        size: dto.size,
      },
      planType,
      orgStorageLimit,
    );

    return {
      fileId: result.fileId,
      uploadUrl: result.uploadUrl,
      storageKey: result.storageKey,
      expiresAt: result.expiresAt,
    };
  }

  // ─── POST /files/confirm ────────────────────────────────────────────────────

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
  )
  @ApiOperation({
    summary: 'Confirm file upload completion',
    description:
      'Verifies that the file has been successfully uploaded to storage and marks the file as COMPLETED. ' +
      'This endpoint must be called after uploading the file to the presigned URL.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upload confirmed successfully.',
    type: ConfirmUploadResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'File not uploaded, expired, or already confirmed.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found.',
  })
  async confirmUpload(
    @Body() dto: ConfirmUploadDto,
    @CurrentOrgId() orgId: string,
    @CurrentDbUserId() userId: string,
  ): Promise<ConfirmUploadResponseDto> {
    const result = await this.storageService.confirmUpload({
      fileId: dto.fileId,
      orgId,
      userId,
    });

    return {
      fileId: result.fileId,
      status: result.status,
      confirmedAt: result.confirmedAt,
    };
  }

  // ─── GET /files/quota ───────────────────────────────────────────────────────

  @Get('quota')
  @HttpCode(HttpStatus.OK)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
    MembershipRole.READ_ONLY,
  )
  @ApiOperation({
    summary: 'Get storage quota and usage',
    description:
      'Returns the current storage quota limits and actual usage for the organization. ' +
      'Limits are derived from the organization subscription plan. ' +
      'Per-org overrides (for custom enterprise deals) take precedence over plan defaults. ' +
      'BigInt fields are serialized as strings to preserve precision.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Storage quota retrieved successfully.',
    type: StorageQuotaResponseDto,
  })
  async getStorageQuota(
    @CurrentOrgId() orgId: string,
  ): Promise<StorageQuotaResponseDto> {
    const { planType, orgStorageLimit } = await this.#resolveOrgPlan(orgId);
    const quota = await this.uploadPolicyService.getStorageQuota(
      orgId,
      planType,
      orgStorageLimit,
    );

    return {
      storageLimitBytes: quota.storageLimitBytes?.toString() ?? null,
      storageUsedBytes: quota.storageUsedBytes.toString(),
      fileCount: quota.fileCount,
      fileCountLimit: quota.fileCountLimit,
      maxFileSizeBytes: quota.maxFileSizeBytes.toString(),
    };
  }

  // ─── GET /files/:id/download ────────────────────────────────────────────────

  @Get(':fileId/download')
  @HttpCode(HttpStatus.OK)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
    MembershipRole.READ_ONLY,
  )
  @ApiOperation({
    summary: 'Generate a presigned download URL',
    description:
      'Generates a presigned URL for downloading the file directly from S3. ' +
      'The URL expires after a configured duration (default 1 hour).',
  })
  @ApiParam({
    name: 'fileId',
    description: 'File identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Download URL generated successfully.',
    type: DownloadUrlResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'File is not available for download (not in COMPLETED status).',
  })
  async generateDownloadUrl(
    @Param('fileId') fileId: string,
    @CurrentOrgId() orgId: string,
    @CurrentDbUserId() userId: string,
  ): Promise<DownloadUrlResponseDto> {
    const result = await this.storageService.generateDownloadUrl({
      fileId,
      orgId,
      userId,
    });

    return {
      downloadUrl: result.downloadUrl,
      expiresAt: result.expiresAt,
      filename: result.filename,
      mimeType: result.mimeType,
      size: result.size?.toString() ?? null,
    };
  }

  // ─── GET /files/:id ─────────────────────────────────────────────────────────

  @Get(':fileId')
  @HttpCode(HttpStatus.OK)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
    MembershipRole.READ_ONLY,
  )
  @ApiOperation({
    summary: 'Get file metadata',
    description: 'Returns metadata for a specific file.',
  })
  @ApiParam({
    name: 'fileId',
    description: 'File identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File metadata retrieved successfully.',
    type: FileMetadataResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found.',
  })
  async getFile(
    @Param('fileId') fileId: string,
    @CurrentOrgId() orgId: string,
  ): Promise<FileMetadataResponseDto> {
    const file = await this.storageService.getFile(fileId, orgId);

    return {
      id: file.id,
      orgId: file.orgId,
      uploadedBy: file.uploadedBy,
      storageKey: file.storageKey,
      provider: file.provider,
      filename: file.filename,
      size: file.size?.toString() ?? null,
      mimeType: file.mimeType,
      status: file.status,
      expiresAt: file.expiresAt,
      confirmedAt: file.confirmedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  // ─── GET /files ─────────────────────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
    MembershipRole.READ_ONLY,
  )
  @ApiOperation({
    summary: 'List organization files',
    description: 'Returns a list of files for the current organization.',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Maximum number of files to return',
    required: false,
    example: 20,
  })
  @ApiQuery({
    name: 'offset',
    description: 'Number of files to skip',
    required: false,
    example: 0,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Files retrieved successfully.',
    type: [FileMetadataResponseDto],
  })
  async listFiles(
    @CurrentOrgId() orgId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<FileMetadataResponseDto[]> {
    const files = await this.storageService.listFiles(orgId, {
      limit,
      offset,
    });

    return files.map((file) => ({
      id: file.id,
      orgId: file.orgId,
      uploadedBy: file.uploadedBy,
      storageKey: file.storageKey,
      provider: file.provider,
      filename: file.filename,
      size: file.size?.toString() ?? null,
      mimeType: file.mimeType,
      status: file.status,
      expiresAt: file.expiresAt,
      confirmedAt: file.confirmedAt,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }));
  }

  // ─── DELETE /files/:id ──────────────────────────────────────────────────────

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireRole(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.MEMBER,
  )
  @ApiOperation({
    summary: 'Delete a file',
    description:
      'Deletes the file from storage and removes its metadata. ' +
      'This operation cannot be undone.',
  })
  @ApiParam({
    name: 'fileId',
    description: 'File identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'File deleted successfully.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'File not found.',
  })
  async deleteFile(
    @Param('fileId') fileId: string,
    @CurrentOrgId() orgId: string,
    @CurrentDbUserId() userId: string,
  ): Promise<void> {
    await this.storageService.deleteFile({
      fileId,
      orgId,
      userId,
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Resolves the plan type and per-org storage override for the given organization.
   * Both lookups run in parallel to minimize latency.
   *
   * The plan tier comes from FeatureFlagsService (Redis-cached) and the
   * orgStorageLimit comes from the billing record (DB, rarely needed).
   */
  async #resolveOrgPlan(
    orgId: string,
  ): Promise<{ planType: PlanType; orgStorageLimit: bigint | null }> {
    const [entitlements, billing] = await Promise.all([
      this.featureFlagsService.getEntitlements(orgId),
      this.billingService.getOrgBillingStatus(orgId),
    ]);

    const planType: PlanType =
      entitlements.plan === 'PRO'
        ? 'pro'
        : entitlements.plan === 'ENTERPRISE'
          ? 'enterprise'
          : 'free';

    return { planType, orgStorageLimit: billing?.storageLimit ?? null };
  }
}
