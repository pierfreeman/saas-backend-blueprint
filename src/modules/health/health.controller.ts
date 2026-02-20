import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<{
    status: string;
    timestamp: string;
    services: {
      database: { status: string; responseTime?: number };
      redis: { status: string; responseTime?: number };
      stripe: { status: string };
    };
  }> {
    return this.healthService.checkHealth();
  }

  @Get('liveness')
  liveness(): { status: string } {
    return { status: 'ok' };
  }

  @Get('readiness')
  async readiness(): Promise<{ status: string; ready: boolean }> {
    const isReady = await this.healthService.checkReadiness();
    return {
      status: isReady ? 'ok' : 'not ready',
      ready: isReady,
    };
  }
}
