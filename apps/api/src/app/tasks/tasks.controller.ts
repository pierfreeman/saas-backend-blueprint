import {
  Controller,
  Post,
  Body,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { TenantRequest } from '@libs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Tasks Controller
 * Handles task creation and management
 */
@ApiTags('Tasks')
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /tasks/heavy-job
   * Creates a heavy computation job and publishes event to Redis
   */
  @Post('heavy-job')
  @HttpCode(HttpStatus.ACCEPTED)
  async createHeavyJob(
    @Body() createTaskDto: CreateTaskDto,
    @Request() req: TenantRequest,
  ) {
    const tenantId = req.tenantContext?.tenantId || 'default';
    this.logger.log(
      `Creating heavy job for tenant: ${tenantId}, payload:`,
      createTaskDto,
    );

    const result = await this.tasksService.createHeavyJob(
      tenantId,
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
