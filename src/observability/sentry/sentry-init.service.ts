import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Sentry Initialization Service
 *
 * Initializes Sentry SDK with proper configuration.
 * Should be called early in the bootstrap process.
 */
export class SentryInitService {
  /**
   * Initialize Sentry if DSN is configured
   */
  static init(configService: ConfigService): void {
    const sentryDsn = configService.get<string>('SENTRY_DSN');

    if (!sentryDsn) {
      console.log('[Sentry] DSN not configured, skipping initialization');
      return;
    }

    const environment =
      configService.get<string>('SENTRY_ENVIRONMENT') ||
      configService.get<string>('APP_ENV') ||
      'unknown';
    const release = configService.get<string>('SENTRY_RELEASE');
    const tracesSampleRate = configService.get<number>('SENTRY_TRACES_SAMPLE_RATE', 0.1);
    const profilesSampleRate = configService.get<number>('SENTRY_PROFILES_SAMPLE_RATE', 0.1);

    Sentry.init({
      dsn: sentryDsn,
      environment,
      release,
      tracesSampleRate,
      profilesSampleRate,
      integrations: [
        nodeProfilingIntegration(),
      ],
      // Capture unhandled promise rejections
      beforeSend(event, hint) {
        // Filter out non-error events in development
        if (environment === 'local' || environment === 'dev') {
          console.log('[Sentry] Would send event:', event);
          return null; // Don't actually send in dev
        }
        return event;
      },
    });

    console.log(`[Sentry] Initialized for environment: ${environment}`);
  }

  /**
   * Set user context for Sentry events
   */
  static setUser(userId: string, email?: string, orgId?: string): void {
    Sentry.setUser({
      id: userId,
      email,
      ...(orgId && { organization_id: orgId }),
    });
  }

  /**
   * Clear user context
   */
  static clearUser(): void {
    Sentry.setUser(null);
  }

  /**
   * Add tags to Sentry events
   */
  static setTags(tags: Record<string, string>): void {
    Sentry.setTags(tags);
  }

  /**
   * Add extra context to Sentry events
   */
  static setContext(name: string, context: Record<string, unknown>): void {
    Sentry.setContext(name, context);
  }
}
