import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

/**
 * Health Controller
 * Provides endpoint for health checks and monitoring
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  /**
   * GET /health
   * Returns API health status
   */
  @Get()
  health() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'api-gateway',
    };
  }
}
