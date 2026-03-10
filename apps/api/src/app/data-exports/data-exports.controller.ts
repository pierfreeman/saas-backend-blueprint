import { JwtAuthGuard, PERMISSIONS } from '@libs/common';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';
import { Request } from 'express';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { DataExportsService } from './data-exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportStatusDto } from './dto/export-status.dto';

/** Shape of the user object attached to the request by JwtStrategy.validate(). */
interface RequestUser {
  sub: string;
  email: string;
}

/**
 * Data Exports Controller
 *
 * Handles organization data export requests for GDPR/ISO27001 compliance.
 * Only OWNER and ADMIN roles can request exports.
 */
@ApiTags('Data Exports')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('organizations/:orgId/data-exports')
export class DataExportsController {
  constructor(private readonly dataExportsService: DataExportsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions([PERMISSIONS.ORG_DATA_EXPORT])
  @ApiOperation({
    summary: 'Request organization data export',
    description:
      'Creates an async job to export all organization data for compliance purposes (GDPR/ISO27001). ' +
      'The export includes organization details, memberships, activity logs, and related data. ' +
      'Only OWNER and ADMIN roles can request exports. ' +
      'Returns a job ID that can be used to poll the export status.',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Export job created and queued for processing.',
    schema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          format: 'uuid',
          example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        status: { type: 'string', example: 'PENDING' },
        message: { type: 'string', example: 'Export job submitted for processing' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have permission to export organization data.',
  })
  async createExport(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Body() createExportDto: CreateExportDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as RequestUser).sub;

    const job = await this.dataExportsService.createExport(
      orgId,
      userId,
      createExportDto.format,
    );

    return {
      jobId: job.id,
      status: JobStatus.PENDING,
      message: 'Export job submitted for processing',
    };
  }

  @Get(':jobId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([PERMISSIONS.ORG_DATA_EXPORT])
  @ApiOperation({
    summary: 'Get export job status',
    description:
      'Returns the current status of a data export job. ' +
      'When the export is complete (status: DONE), a downloadUrl will be provided. ' +
      'The download URL is a pre-signed S3 URL with limited validity (typically 1 hour).',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiParam({
    name: 'jobId',
    description: 'Export job UUID',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Export job status retrieved successfully.',
    type: ExportStatusDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Export job not found or belongs to a different organization.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User does not have permission to view export status.',
  })
  async getExportStatus(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<ExportStatusDto> {
    const job = await this.dataExportsService.getExportStatus(jobId, orgId);

    return {
      id: job.id,
      status: job.status,
      downloadUrl: job.result?.downloadUrl,
      error: job.error ?? undefined,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
  }
}
