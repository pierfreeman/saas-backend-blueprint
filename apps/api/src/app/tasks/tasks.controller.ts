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
   * Creates a heavy computation job and publishes event to Redis
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
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT token.',
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
