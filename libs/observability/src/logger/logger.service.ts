import { Injectable, LoggerService } from '@nestjs/common';
import { LogContext } from './logger.interfaces';

type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

const LEVEL_RANK: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  verbose: '\x1b[35m', // magenta
  debug: '\x1b[34m', // blue
  log: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  fatal: '\x1b[41m', // red background
};

const RESET = '\x1b[0m';

/**
 * ObservabilityLoggerService
 *
 * Production-grade structured logger for multi-tenant SaaS apps.
 *
 * ── Modes ──────────────────────────────────────────────────────────────────
 * Development (LOG_FORMAT=pretty or NODE_ENV != production):
 *   Coloured, human-readable output (same style as NestJS default).
 *
 * Production (NODE_ENV=production or LOG_FORMAT=json):
 *   NDJSON lines consumed by log aggregators (CloudWatch, Datadog, ELK).
 *   Shape: { timestamp, level, message, context?, tenantId?, orgId?, ... }
 *
 * ── Multi-tenant safety ────────────────────────────────────────────────────
 * Accepts only opaque IDs (tenantId, orgId, userId) — never PII like emails
 * or names. Callers are responsible for not passing PII in LogContext.
 *
 * ── NestJS LoggerService compatibility ────────────────────────────────────
 * Implements `LoggerService` so it can be set as the global app logger:
 *   app.useLogger(app.get(ObservabilityLoggerService));
 *
 * ── Structured context methods ─────────────────────────────────────────────
 * Use `logCtx`, `errorCtx`, `warnCtx`, `debugCtx` in application code
 * to pass tenant/request metadata. The standard `log`/`error`/`warn`/`debug`
 * methods stay compatible with NestJS internals.
 */
@Injectable()
export class ObservabilityLoggerService implements LoggerService {
  private readonly isJson: boolean;
  private readonly minLevel: LogLevel;

  constructor() {
    this.isJson =
      process.env['NODE_ENV'] === 'production' ||
      process.env['LOG_FORMAT'] === 'json';
    this.minLevel = (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'log';
  }

  // ── NestJS LoggerService interface ─────────────────────────────────────────

  log(message: any, ...optionalParams: any[]): void {
    this.emit('log', message, optionalParams);
  }

  error(message: any, ...optionalParams: any[]): void {
    this.emit('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: any, ...optionalParams: any[]): void {
    this.emit('fatal', message, optionalParams);
  }

  // ── Structured context-aware API (preferred in application code) ───────────

  /**
   * Log at INFO level with structured tenant/request context.
   *
   * @example
   * this.logger.logCtx('User invited', { tenantId, orgId, actorRole }, 'InviteService');
   */
  logCtx(message: string, meta: LogContext, label?: string): void {
    this.write('log', message, meta, undefined, label);
  }

  /**
   * Log at ERROR level with structured context and optional Error instance.
   *
   * @example
   * this.logger.errorCtx('Payment failed', err, { tenantId, orgId }, 'BillingService');
   */
  errorCtx(
    message: string,
    error: Error,
    meta: LogContext,
    label?: string,
  ): void {
    const err = error instanceof Error ? error : undefined;
    this.write('error', message, meta, err, label);
  }

  /**
   * Log at WARN level with structured context.
   */
  warnCtx(message: string, meta: LogContext, label?: string): void {
    this.write('warn', message, meta, undefined, label);
  }

  /**
   * Log at DEBUG level with structured context.
   */
  debugCtx(message: string, meta: LogContext, label?: string): void {
    this.write('debug', message, meta, undefined, label);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Parse NestJS's variadic params convention and delegate to `write`.
   * NestJS Logger uses `(message, context?)` where context is a string label.
   */
  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    const [first, ...rest] = params;
    // NestJS standard: last string param is the class-name context label
    const labelFromFirst = typeof first === 'string' ? first : undefined;
    const label =
      labelFromFirst ?? (typeof rest[0] === 'string' ? rest[0] : undefined);

    // Error stack comes as second arg from NestJS internal logger
    const errorStack =
      level === 'error' && typeof first === 'string' && !label
        ? first
        : undefined;

    let err: Error | undefined;
    if (errorStack) {
      err = new Error(JSON.stringify(message));
      err.stack = errorStack;
    }

    this.write(level, JSON.stringify(message), {}, err, label);
  }

  private write(
    level: LogLevel,
    message: string,
    meta: LogContext,
    error?: Error,
    label?: string,
  ): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();

    if (this.isJson) {
      this.writeJson(level, message, meta, error, label, timestamp);
    } else {
      this.writePretty(level, message, meta, error, label, timestamp);
    }
  }

  private writeJson(
    level: LogLevel,
    message: string,
    meta: LogContext,
    error: Error | undefined,
    label: string | undefined,
    timestamp: string,
  ): void {
    const entry: Record<string, unknown> = {
      timestamp,
      level,
      message,
    };

    if (label) entry['context'] = label;

    // Spread tenant/request context fields — exclude undefined values
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) entry[k] = v;
    }

    if (error) {
      entry['error'] = {
        name: error.name,
        message: error.message,
        // Emit only first stack frame to avoid log bloat; use Sentry for full traces
        stack: error.stack?.split('\n').slice(0, 3).join(String.raw`\n`) ?? '',
      };
    }

    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  private writePretty(
    level: LogLevel,
    message: string,
    meta: LogContext,
    error: Error | undefined,
    label: string | undefined,
    timestamp: string,
  ): void {
    const color = LEVEL_COLOR[level];
    const levelPad = level.toUpperCase().padEnd(7);
    const ctx = label ? ` \x1b[36m[${label}]\x1b[0m` : '';
    const metaKeys = Object.entries(meta).filter(([, v]) => v !== undefined);
    const metaSuffix =
      metaKeys.length > 0
        ? ` \x1b[90m${JSON.stringify(Object.fromEntries(metaKeys))}\x1b[0m`
        : '';

    const line = `${RESET}\x1b[90m${timestamp}\x1b[0m ${color}${levelPad}${RESET}${ctx} ${message}${metaSuffix}`;
    const stream =
      level === 'error' || level === 'fatal' ? process.stderr : process.stdout;
    stream.write(line + '\n');

    if (error?.stack) {
      stream.write(`\x1b[90m${error.stack}\x1b[0m\n`);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= (LEVEL_RANK[this.minLevel] ?? 0);
  }
}
