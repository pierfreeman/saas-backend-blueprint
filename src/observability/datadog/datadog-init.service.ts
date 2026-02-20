import { ConfigService } from '@nestjs/config';
import * as tracer from 'dd-trace';

/**
 * Datadog Initialization Service
 *
 * Initializes Datadog APM (dd-trace) if configured.
 * Must be imported and initialized before any other modules.
 */
export class DatadogInitService {
  /**
   * Initialize Datadog APM
   *
   * IMPORTANT: This should be called at the very top of main.ts,
   * before any other imports, for dd-trace to properly instrument all modules.
   */
  static init(configService: ConfigService): void {
    const apiKey = configService.get<string>('DATADOG_API_KEY');

    if (!apiKey) {
      console.log('[Datadog] API key not configured, skipping initialization');
      return;
    }

    const service = configService.get<string>('DATADOG_SERVICE', 'sports-intelligence-backend');
    const env =
      configService.get<string>('DATADOG_ENV') || configService.get<string>('APP_ENV') || 'unknown';
    const version = configService.get<string>('DATADOG_VERSION', '1.0.0');
    const site = configService.get<string>('DATADOG_SITE', 'datadoghq.com');

    try {
      // Require dd-trace dynamically (it should be imported at the very top of main.ts)
      tracer.init({
        service,
        env,
        version,
        logInjection: true, // Inject trace IDs into logs
        runtimeMetrics: true, // Enable runtime metrics
        profiling: true, // Enable profiling
        // site,
      });

      console.log(`[Datadog] APM initialized for service: ${service}, env: ${env}`);
    } catch (error) {
      console.error('[Datadog] Failed to initialize APM:', error);
    }
  }

  /**
   * Get the current tracer instance
   */
  static getTracer(): typeof import('dd-trace') | null {
    try {
      return require('dd-trace');
    } catch {
      return null;
    }
  }
}
