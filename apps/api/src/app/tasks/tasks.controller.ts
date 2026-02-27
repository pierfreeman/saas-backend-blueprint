import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { JobStatusDto } from './dto/job-status.dto';
import { CurrentTenant } from '@libs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Job } from '@prisma/client';

/** Shape of the user object attached to the request by JwtStrategy.validate(). */
interface RequestUser {
  sub: string;
  email: string;
}

/**
 * Tasks Controller
 * Handles task submission and status inspection.
 */
@ApiTags('Tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

  // ── POST /tasks/heavy-job ──────────────────────────────────────────────────

  /**
   * POST /tasks/heavy-job
   * Persists a PENDING job and publishes a HEAVY_JOB_CREATED event to SQS.
   * The worker will process the job asynchronously and push real-time
   * status updates via the `/jobs` WebSocket namespace.
   */
  @Post('heavy-job')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a heavy computation job',
    description:
      'Persists a PENDING job record and publishes a domain event to SQS for async ' +
      'processing by the worker fleet.  Poll GET /tasks/:jobId or connect to the ' +
      '`/jobs` WebSocket namespace (`job:update` event) for real-time status updates.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Job accepted and queued for processing.',
    schema: {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          format: 'uuid',
          description: 'Unique identifier of the enqueued job.',
          example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        },
        status: { type: 'string', example: 'accepted' },
        message: { type: 'string', example: 'Job submitted for processing' },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-27T10:00:00.000Z',
        },
      },
      required: ['jobId', 'status', 'message', 'timestamp'],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — check request body against the schema.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['name should not be empty'],
        },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT token.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  async createHeavyJob(
    @Body() createTaskDto: CreateTaskDto,
    @CurrentTenant('tenantId') tenantId: string | undefined,
    @Req() req: Request,
  ) {
    const resolvedTenantId = tenantId ?? 'default';
    const userId = (req.user as RequestUser | undefined)?.sub;

    this.logger.log(
      `Creating heavy job | tenant: ${resolvedTenantId} | user: ${userId ?? 'system'}`,
    );

    const result = await this.tasksService.createHeavyJob(
      resolvedTenantId,
      createTaskDto,
      userId,
    );

    return {
      jobId: result.jobId,
      status: 'accepted',
      message: 'Job submitted for processing',
      timestamp: new Date().toISOString(),
    };
  }

  // ── GET /tasks/:jobId ──────────────────────────────────────────────────────

  /**
   * GET /tasks/:jobId
   * Returns the current status, result, and metadata of a job.
   * Scoped to the caller's tenant — returns 404 for jobs belonging to other tenants.
   * Use this endpoint as a polling fallback when the WebSocket is not available.
   */
  @Get(':jobId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get job status',
    description:
      'Returns the current lifecycle status, result (on success), and error message ' +
      "(on failure) of a background job.  Scoped to the caller's tenant to prevent " +
      'cross-tenant data leakage.  Use as a polling fallback when the `/jobs` WebSocket ' +
      'namespace is not available.',
  })
  @ApiParam({
    name: 'jobId',
    description: 'UUID of the job returned by POST /tasks/heavy-job.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current job status and metadata.',
    type: JobStatusDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Job not found or belongs to a different tenant.',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 404 },
        message: { type: 'string', example: 'Job <id> not found' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT token.',
  })
  async getJobStatus(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
    @CurrentTenant('tenantId') tenantId: string | undefined,
  ): Promise<JobStatusDto> {
    const resolvedTenantId = tenantId ?? 'default';
    const job: Job = await this.tasksService.findJobById(
      jobId,
      resolvedTenantId,
    );

    return {
      jobId: job.id,
      status: job.status,
      type: job.type,
      result: job.result ?? undefined,
      error: job.error ?? undefined,
      attempts: job.attempts,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
