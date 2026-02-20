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
  ParseIntPipe,
  Logger,
  Inject,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { StorageFacade } from '../facade/storage.facade';
import {
  CreateUploadSessionDto,
  CompleteUploadDto,
  AbortUploadDto,
  GeneratePresignedPartUrlDto,
} from '../dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OrgContextGuard, RequestWithOrgContext } from '../../rbac/guards/org-context.guard';
import { RBACGuard } from '../../rbac/guards/rbac.guard';
import { RequirePermissions } from '../../rbac/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../rbac/constants/permissions.constants';
import { FileEntityType } from '@prisma/client';

/**
 * Storage Controller
 *
 * Handles file storage operations with:
 * - Direct upload via presigned URLs
 * - Multipart upload for large files
 * - RBAC enforcement
 * - Quota validation
 * - Audit logging
 */
@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(private readonly storageFacade: StorageFacade) {}

  /**
   * Create upload session (Step 1)
   * POST /storage/upload-session
   */
  @Post('upload-session')
  @RequirePermissions([PERMISSIONS.FILE_UPLOAD])
  @ApiOperation({ summary: 'Create upload session for multipart upload' })
  @ApiResponse({
    status: 201,
    description: 'Upload session created successfully',
  })
  @ApiResponse({ status: 403, description: 'Quota exceeded or permission denied' })
  async createUploadSession(
    @Body() dto: CreateUploadSessionDto,
    @Req() req: RequestWithOrgContext,
  ) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    const result = await this.storageFacade.createUploadSession(dto, orgId, userId);

    return {
      uploadSessionId: result.session.id,
      uploadConfig: result.uploadConfig,
      expiresAt: result.session.expiresAt,
    };
  }

  /**
   * Generate presigned URL for part upload (Step 2)
   * POST /storage/upload-session/:id/presigned-part
   */
  @Post('upload-session/:id/presigned-part')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([PERMISSIONS.FILE_UPLOAD])
  @ApiOperation({ summary: 'Generate presigned URL for uploading a part' })
  @ApiParam({ name: 'id', description: 'Upload session ID' })
  @ApiResponse({ status: 200, description: 'Presigned URL generated' })
  @ApiResponse({ status: 404, description: 'Upload session not found' })
  async generatePresignedPartUrl(
    @Param('id') sessionId: string,
    @Body() dto: GeneratePresignedPartUrlDto,
    @Req() req: RequestWithOrgContext,
  ) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    const result = await this.storageFacade.generatePresignedPartUrl(
      sessionId,
      dto.partNumber,
      orgId,
      userId,
    );

    return result;
  }

  /**
   * Complete upload (Step 3)
   * POST /storage/upload-session/:id/complete
   */
  @Post('upload-session/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([PERMISSIONS.FILE_UPLOAD])
  @ApiOperation({ summary: 'Complete multipart upload' })
  @ApiParam({ name: 'id', description: 'Upload session ID' })
  @ApiResponse({ status: 200, description: 'Upload completed, file created' })
  @ApiResponse({ status: 400, description: 'Invalid upload session or parts' })
  async completeUpload(
    @Param('id') sessionId: string,
    @Body() dto: CompleteUploadDto,
    @Req() req: RequestWithOrgContext,
  ) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    const file = await this.storageFacade.completeUpload(sessionId, dto, orgId, userId);

    return {
      fileId: file.id,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes.toString(),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  /**
   * Abort upload (Step 4)
   * POST /storage/upload-session/:id/abort
   */
  @Post('upload-session/:id/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([PERMISSIONS.FILE_UPLOAD])
  @ApiOperation({ summary: 'Abort multipart upload and cleanup' })
  @ApiParam({ name: 'id', description: 'Upload session ID' })
  @ApiResponse({ status: 204, description: 'Upload aborted successfully' })
  async abortUpload(
    @Param('id') sessionId: string,
    @Body() dto: AbortUploadDto,
    @Req() req: RequestWithOrgContext,
  ) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    await this.storageFacade.abortUpload(sessionId, orgId, userId, dto.reason);
  }

  /**
   * Get download URL
   * GET /storage/files/:id/download-url
   */
  @Get('files/:id/download-url')
  @RequirePermissions([PERMISSIONS.FILE_READ])
  @ApiOperation({ summary: 'Generate presigned download URL for file' })
  @ApiParam({ name: 'id', description: 'File ID' })
  @ApiResponse({ status: 200, description: 'Download URL generated' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getDownloadUrl(@Param('id') fileId: string, @Req() req: RequestWithOrgContext) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    const result = await this.storageFacade.getDownloadUrl(fileId, orgId, userId);

    return result;
  }

  /**
   * Get file metadata
   * GET /storage/files/:id
   */
  @Get('files/:id')
  @RequirePermissions([PERMISSIONS.FILE_READ])
  @ApiOperation({ summary: 'Get file metadata by ID' })
  @ApiParam({ name: 'id', description: 'File ID' })
  @ApiResponse({ status: 200, description: 'File metadata' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFile(@Param('id') fileId: string, @Req() req: RequestWithOrgContext) {
    const orgId = req.orgId!;

    const file = await this.storageFacade.getFile(fileId, orgId);

    return file.toJSON();
  }

  /**
   * List files
   * GET /storage/files
   */
  @Get('files')
  @RequirePermissions([PERMISSIONS.FILE_READ])
  @ApiOperation({ summary: 'List files for organization' })
  @ApiQuery({ name: 'entityType', required: false, enum: FileEntityType })
  @ApiQuery({ name: 'entityId', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 100 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiResponse({ status: 200, description: 'List of files' })
  async listFiles(
    @Query('entityType') entityType: FileEntityType | undefined,
    @Query('entityId') entityId: string | undefined,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number | undefined,
    @Query('offset', new ParseIntPipe({ optional: true })) offset: number | undefined,
    @Req() req: RequestWithOrgContext,
  ) {
    const orgId = req.orgId!;

    const files = await this.storageFacade.listFiles(orgId, {
      entityType,
      entityId,
      limit,
      offset,
    });

    return {
      files: files.map((file) => file.toJSON()),
      count: files.length,
    };
  }

  /**
   * Delete file
   * DELETE /storage/files/:id
   */
  @Delete('files/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([PERMISSIONS.FILE_DELETE])
  @ApiOperation({ summary: 'Delete file (soft delete)' })
  @ApiParam({ name: 'id', description: 'File ID' })
  @ApiResponse({ status: 204, description: 'File deleted successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async deleteFile(@Param('id') fileId: string, @Req() req: RequestWithOrgContext) {
    const userId = req.user.dbUserId!;
    const orgId = req.orgId!;

    await this.storageFacade.deleteFile(fileId, orgId, userId);
  }

  /**
   * Get quota usage
   * GET /storage/quota
   */
  @Get('quota')
  @RequirePermissions([PERMISSIONS.FILE_READ])
  @ApiOperation({ summary: 'Get storage quota usage for organization' })
  @ApiResponse({ status: 200, description: 'Quota usage information' })
  async getQuotaUsage(@Req() req: RequestWithOrgContext) {
    const orgId = req.orgId!;

    const usage = await this.storageFacade.getQuotaUsage(orgId);

    return usage;
  }
}
