import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Full health check',
    description:
      'Returns the health status of the application and its dependencies (database, Redis).',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Health check result.',
  })
  async check(): Promise<{
    status: string;
    timestamp: string;
    services: {
      database: { status: string; responseTime?: number };
      redis: { status: string; responseTime?: number };
      // stripe: { status: string };
    };
  }> {
    return this.healthService.checkHealth();
  }

  @Get('liveness')
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Confirms the process is alive. Used by orchestrators (Kubernetes, ECS) to decide whether to restart the container.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Process is alive.',
  })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks whether the application is ready to serve traffic (DB + Redis reachable).',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Readiness status.',
  })
  async readiness(): Promise<{ status: string; ready: boolean }> {
    const isReady = await this.healthService.checkReadiness();
    return {
      status: isReady ? 'ok' : 'not ready',
      ready: isReady,
    };
  }
}
