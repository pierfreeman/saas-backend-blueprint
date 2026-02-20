/**
 * Application Logger Interface
 *
 * Provides a unified logging interface that can be implemented by different providers
 * (NestJS Logger, Sentry, Datadog, etc.)
 */
export interface IAppLogger {
  /**
   * Log a message at the "log" level
   */
  log(message: string, context?: string, metadata?: Record<string, unknown>): void;

  /**
   * Log an error with optional stack trace
   */
  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void;

  /**
   * Log a warning message
   */
  warn(message: string, context?: string, metadata?: Record<string, unknown>): void;

  /**
   * Log a debug message
   */
  debug(message: string, context?: string, metadata?: Record<string, unknown>): void;

  /**
   * Log a verbose message
   */
  verbose(message: string, context?: string, metadata?: Record<string, unknown>): void;
}
