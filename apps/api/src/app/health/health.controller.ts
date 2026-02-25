import { Controller, Get } from "@nestjs/common";

/**
 * Health Controller
 * Provides endpoint for health checks and monitoring
 */
@Controller("health")
export class HealthController {
  /**
   * GET /health
   * Returns API health status
   */
  @Get()
  health() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "api-gateway",
    };
  }
}
