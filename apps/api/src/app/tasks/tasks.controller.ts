import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { CurrentTenant } from '@libs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Tasks Controller
 * Handles task creation and management
 */
@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /tasks/heavy-job
   * Creates a heavy computation job and publishes the event to SQS for async processing.
   */
  @UseGuards(JwtAuthGuard)
  @Post('heavy-job')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Submit a heavy computation job',
    description:
      'Creates a heavy computation job and publishes the event to Redis for async processing.',
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
        status: {
          type: 'string',
          example: 'accepted',
        },
        message: {
          type: 'string',
          example: 'Job submitted for processing',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
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
  ) {
    const resolvedTenantId = tenantId ?? 'default';
    this.logger.log(
      `Creating heavy job for tenant: ${resolvedTenantId}, payload:`,
      createTaskDto,
    );

    const result = await this.tasksService.createHeavyJob(
      resolvedTenantId,
      createTaskDto,
    );

    return {
      jobId: result.jobId,
      status: 'accepted',
      message: 'Job submitted for processing',
      timestamp: new Date().toISOString(),
    };
  }
}
