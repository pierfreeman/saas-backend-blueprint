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
      'Returns the health status of the application and its external dependencies ' +
      '(PostgreSQL database and Redis). Each service reports its reachability ' +
      'and response time in milliseconds.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health check result with per-dependency status.',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ok', 'degraded', 'error'],
          example: 'ok',
        },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        services: {
          type: 'object',
          properties: {
            database: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['ok', 'error'],
                  example: 'ok',
                },
                responseTime: {
                  type: 'number',
                  description: 'Round-trip latency in ms.',
                  example: 4,
                },
              },
              required: ['status'],
            },
            redis: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['ok', 'error'],
                  example: 'ok',
                },
                responseTime: {
                  type: 'number',
                  description: 'Round-trip latency in ms.',
                  example: 1,
                },
              },
              required: ['status'],
            },
          },
          required: ['database', 'redis'],
        },
      },
      required: ['status', 'timestamp', 'services'],
    },
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
      'Confirms the process is alive. Used by orchestrators (Kubernetes, ECS) ' +
      'to decide whether to restart the container. This probe never checks external ' +
      'dependencies — it only verifies the Node.js process is responsive.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Process is alive.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
      required: ['status'],
    },
  })
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks whether the application is ready to serve traffic by verifying ' +
      'that PostgreSQL and Redis are reachable. Orchestrators (Kubernetes, ECS) ' +
      'use this to decide whether to route requests to the container.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'Readiness status — ready: false means the app is still warming up.',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'not ready'], example: 'ok' },
        ready: { type: 'boolean', example: true },
      },
      required: ['status', 'ready'],
    },
  })
  async readiness(): Promise<{ status: string; ready: boolean }> {
    const isReady = await this.healthService.checkReadiness();
    return {
      status: isReady ? 'ok' : 'not ready',
      ready: isReady,
    };
  }
}
