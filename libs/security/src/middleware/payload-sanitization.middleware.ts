import {
  BadRequestException,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { LegalAuditService } from '@libs/legal-audit';
import { extractClientIp } from '../utils/ip.utils';

type PlainObject = Record<string, unknown>;

/**
 * Conservative SQL injection signatures.
 *
 * Targets explicit injection syntax rather than bare keywords to avoid
 * false positives on legitimate user content (e.g. a comment containing
 * "SELECT" or "ORDER BY").  Patterns require contextual signals like
 * quoting, structural SQL, or specific dangerous functions.
 */
const SQL_INJECTION_PATTERNS: RegExp[] = [
  // Boolean-based: ' OR 1=1 / ' OR 'a'='a / " AND "x"="x
  /['"`]\s*(?:OR|AND)\s+(?:['"`\d]|TRUE|FALSE)/gi,
  // UNION SELECT — classic exfiltration vector
  /\bUNION\s+(?:ALL\s+)?SELECT\b/gi,
  // DDL — DROP / TRUNCATE TABLE or DATABASE
  /\b(?:DROP|TRUNCATE)\s+(?:TABLE|DATABASE|SCHEMA)\b/gi,
  // Stored procedure / dynamic SQL execution
  /\bEXEC(?:UTE)?\s*\(/gi,
  // SQL Server extended procedures
  /\bxp_\w+\s*\(/gi,
  // Time-based blind injection
  /\bWAITFOR\s+DELAY\b/gi,
  // SQL block comments used to fragment keywords
  /\/\*[\s\S]*?\*\//,
];

/**
 * XSS signatures to sanitize (strip) from string values.
 * We sanitize rather than block to preserve request intent while
 * removing the dangerous payload fragments.
 */
const XSS_PATTERNS: RegExp[] = [
  // Full <script> blocks
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  // Opening <script tag (handles self-closing and malformed variants)
  /<\s*script(\s|\/|>)/gi,
  // javascript: URI scheme
  /javascript\s*:/gi,
  // Inline DOM event handlers (onclick=, onload=, onerror=, …)
  /on(?:abort|blur|change|click|dblclick|error|focus|input|keydown|keypress|keyup|load|mousedown|mouseenter|mouseleave|mousemove|mouseout|mouseover|mouseup|reset|resize|scroll|select|submit|unload)\s*=/gi,
  // Dangerous embeddable elements
  // NOTE: \s*(?:\/\s*)? instead of \s*\/?\s* to prevent super-linear
  // backtracking: two adjacent \s* groups competing over the same spaces
  // would create O(n²) backtracking on crafted inputs (ReDoS).
  /<\s*(?:\/\s*)?(?:iframe|object|embed|applet|meta|link|base)\b[^>]*>/gi,
  // Expression() in CSS (used in old IE)
  /expression\s*\(/gi,
];

/**
 * Recursively extracts all string leaf values from a value tree.
 * Used to check body / query / params for SQL injection patterns.
 */
function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.flatMap((item) => collectStrings(item, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.values(value as PlainObject).flatMap((v) =>
      collectStrings(v, depth + 1),
    );
  return [];
}

/**
 * Returns true if the object tree contains any key starting with '$',
 * which signals MongoDB-style NoSQL operator injection.
 */
function hasNoSqlOperatorKey(value: unknown, depth = 0): boolean {
  if (depth > 10 || typeof value !== 'object' || value === null) return false;
  if (Array.isArray(value))
    return value.some((item) => hasNoSqlOperatorKey(item, depth + 1));
  for (const key of Object.keys(value as PlainObject)) {
    if (key.startsWith('$')) return true;
    if (hasNoSqlOperatorKey((value as PlainObject)[key], depth + 1))
      return true;
  }
  return false;
}

/** Strip XSS patterns from a single string value. */
function sanitizeString(raw: string): string {
  let out = raw;
  for (const pattern of XSS_PATTERNS) {
    out = out.replace(pattern, '');
  }
  return out;
}

/** Recursively sanitize XSS from all string values in a value tree. */
function sanitizeDeep(
  value: unknown,
  depth = 0,
): { result: unknown; changed: boolean } {
  if (depth > 10) return { result: value, changed: false };

  if (typeof value === 'string') {
    const cleaned = sanitizeString(value);
    return { result: cleaned, changed: cleaned !== value };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const r = sanitizeDeep(item, depth + 1);
      if (r.changed) changed = true;
      return r.result;
    });
    return { result, changed };
  }

  if (value !== null && typeof value === 'object') {
    let changed = false;
    const result: PlainObject = {};
    for (const [k, v] of Object.entries(value as PlainObject)) {
      const r = sanitizeDeep(v, depth + 1);
      if (r.changed) changed = true;
      result[k] = r.result;
    }
    return { result, changed };
  }

  return { result: value, changed: false };
}

/**
 * PayloadSanitizationMiddleware
 *
 * Middleware that inspects every incoming request body, query string,
 * and path parameters for known attack payloads:
 *
 *  1. **NoSQL operator injection** (MongoDB $-prefixed keys in body)
 *     → Blocked with 400 Bad Request. Structural attack; cannot be
 *       safely sanitized without changing request semantics.
 *
 *  2. **SQL injection** (structural SQL syntax in string values)
 *     → Blocked with 400 Bad Request. Conservative patterns only to
 *       minimise false positives on legitimate content.
 *
 *  3. **XSS fragments** (script tags, javascript: URIs, inline handlers)
 *     → Sanitized (stripped) from body string values rather than
 *       blocked, to preserve the rest of the request intent.
 *
 * For APIs that exclusively use Auth0 Bearer tokens and Prisma (fully
 * parameterized queries), this is a defence-in-depth layer — the
 * application itself is largely immune to SQL injection at the DB level.
 * This middleware catches payloads before they reach application logic
 * and provides audit trails for security monitoring.
 *
 * Can be disabled per-environment via PAYLOAD_SANITIZATION_ENABLED=false.
 *
 * Middleware position: after request size check, before tenant resolution.
 */
@Injectable()
export class PayloadSanitizationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PayloadSanitizationMiddleware.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly legalAuditService: LegalAuditService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const enabled =
      this.configService.get<boolean>(
        'security.payloadSanitization.enabled',
      ) !== false;

    if (!enabled) {
      next();
      return;
    }

    const ip = extractClientIp(req);

    // ── 1. NoSQL operator-key injection ──────────────────────────────────────
    // Only check the parsed body (query string keys rarely contain $).
    if (req.body !== undefined && hasNoSqlOperatorKey(req.body)) {
      this.logger.warn(
        `NoSQL injection attempt from IP ${ip} → ${req.method} ${req.url}`,
      );
      this.legalAuditService.recordEvent({
        eventType: 'security.payload.nosql_injection_attempt',
        triggerType: 'system',
        metadata: {
          ip,
          path: req.url,
          method: req.method,
          threat: 'nosql_injection',
        },
      });
      throw new BadRequestException(
        'Request payload contains invalid content.',
      );
    }

    // ── 2. SQL injection in string values ────────────────────────────────────
    const allStrings = [
      ...collectStrings(req.body),
      ...collectStrings(req.query),
      ...collectStrings(req.params),
    ];

    const hasSqlInjection = allStrings.some((str) =>
      SQL_INJECTION_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0; // reset stateful global regex before each test
        return pattern.test(str);
      }),
    );

    if (hasSqlInjection) {
      this.logger.warn(
        `SQL injection attempt from IP ${ip} → ${req.method} ${req.url}`,
      );
      this.legalAuditService.recordEvent({
        eventType: 'security.payload.sql_injection_attempt',
        triggerType: 'system',
        metadata: {
          ip,
          path: req.url,
          method: req.method,
          threat: 'sql_injection',
        },
      });
      throw new BadRequestException(
        'Request payload contains invalid content.',
      );
    }

    // ── 3. XSS sanitization of body string values ────────────────────────────
    if (req.body !== undefined) {
      const { result, changed } = sanitizeDeep(req.body);
      if (changed) {
        this.logger.warn(
          `XSS content sanitized in request from IP ${ip} → ${req.method} ${req.url}`,
        );
        this.legalAuditService.recordEvent({
          eventType: 'security.payload.xss_sanitized',
          triggerType: 'system',
          metadata: {
            ip,
            path: req.url,
            method: req.method,
            threat: 'xss',
          },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).body = result;
      }
    }

    next();
  }
}
