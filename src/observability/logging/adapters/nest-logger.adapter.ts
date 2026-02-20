import { LogLevel } from '@nestjs/common';
import chalk from 'chalk';
import { IAppLogger } from '../interfaces/logger.interface';
import { RequestContextService } from '../../middleware/request-context.service';

/**
 * NestJS Logger Adapter
 *
 * Simple console-based logger that enriches logs with request context.
 * Used in local/dev environments and as fallback.
 *
 * NOTE: Does NOT use NestJS Logger internally to avoid circular dependency
 * when set as the global logger via app.useLogger()
 */
export class NestLoggerAdapter implements IAppLogger {
  constructor(private readonly logLevel: LogLevel = 'debug') {}

  log(message: string, context?: string, metadata?: Record<string, unknown>): void {
    const enriched = this.enrichWithContext(message, metadata);
    const timestamp = new Date().toISOString();
    const formattedMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.green('LOG')} ${chalk.yellow(`[${context || 'App'}]`)} ${enriched}`;
    console.log(formattedMessage);
  }

  error(
    message: string,
    trace?: string,
    context?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const enriched = this.enrichWithContext(message, metadata);
    const timestamp = new Date().toISOString();
    const formattedMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.red('ERROR')} ${chalk.yellow(`[${context || 'App'}]`)} ${enriched}`;
    console.error(formattedMessage);
    if (trace) {
      console.error(chalk.red(trace));
    }
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>): void {
    const enriched = this.enrichWithContext(message, metadata);
    const timestamp = new Date().toISOString();
    const formattedMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.yellow('WARN')} ${chalk.yellow(`[${context || 'App'}]`)} ${enriched}`;
    console.warn(formattedMessage);
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    const enriched = this.enrichWithContext(message, metadata);
    const timestamp = new Date().toISOString();
    const formattedMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.magenta('DEBUG')} ${chalk.yellow(`[${context || 'App'}]`)} ${enriched}`;
    console.debug(formattedMessage);
  }

  verbose(message: string, context?: string, metadata?: Record<string, unknown>): void {
    const enriched = this.enrichWithContext(message, metadata);
    const timestamp = new Date().toISOString();
    const formattedMessage = `${chalk.gray(`[${timestamp}]`)} ${chalk.cyan('VERBOSE')} ${chalk.yellow(`[${context || 'App'}]`)} ${enriched}`;
    console.log(formattedMessage);
  }

  private enrichWithContext(message: string, metadata?: Record<string, unknown>): string {
    const context = RequestContextService.getContext();

    if (!context && !metadata) {
      return message;
    }

    const enrichment: Record<string, unknown> = {};

    if (context) {
      if (context.requestId) enrichment.requestId = context.requestId;
      if (context.userId) enrichment.userId = context.userId;
      if (context.orgId) enrichment.orgId = context.orgId;
    }

    if (metadata) {
      Object.assign(enrichment, metadata);
    }

    if (Object.keys(enrichment).length === 0) {
      return message;
    }

    return `${message} ${JSON.stringify(enrichment)}`;
  }
}
