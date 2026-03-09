import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { extractClientIp } from '../utils/ip.utils';

/**
 * Parses a human-readable size string into raw bytes.
 *
 * Accepted formats: "2mb", "500kb", "1024b", "1024" (bare number = bytes).
 * Falls back to 2 MiB for unrecognised formats.
 *
 * Examples:
 *   parseSize("2mb")   → 2097152
 *   parseSize("500kb") → 512000
 *   parseSize("1024")  → 1024
 */
export function parseSize(raw: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(raw.trim());
  if (!match) return 2 * 1_024 * 1_024;
  const value = Number.parseFloat(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1_024,
    mb: 1_024 * 1_024,
    gb: 1_024 * 1_024 * 1_024,
  };
  return Math.floor(value * (multipliers[unit] ?? 1));
}

/**
 * RequestSizeLimitMiddleware
 *
 * Fast pre-body-parse guard that rejects requests whose declared
 * Content-Length exceeds the configured maximum body size.
 *
 * Why a middleware rather than relying on body-parser's own limit?
 * - Provides an explicit, configurable limit with structured logging
 *   and audit-friendly error responses.
 * - Catches oversized requests before body parsing begins, reducing
 *   unnecessary CPU and memory consumption.
 * - body-parser's built-in limit is a complementary defence (both
 *   should be configured to the same value).
 *
 * Note: Content-Length is advisory — clients using chunked transfer
 * encoding may omit it.  For complete protection, configure the same
 * limit in the body-parser setup as well.
 *
 * Configuration: MAX_BODY_SIZE env var (default "2mb").
 * Accepted formats: "2mb", "500kb", "1024b", "1024".
 */
@Injectable()
export class RequestSizeLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestSizeLimitMiddleware.name);
  private readonly maxBytes: number;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>('security.maxBodySize') ?? '2mb';
    this.maxBytes = parseSize(raw);
  }

  use(req: Request, _res: Response, next: NextFunction): void {
    const contentLength = Number(req.headers['content-length'] ?? 0);

    if (contentLength > this.maxBytes) {
      const ip = extractClientIp(req);
      this.logger.warn(
        `Payload too large from IP ${ip} → ${req.method} ${req.url} ` +
          `(${contentLength} bytes > ${this.maxBytes} bytes)`,
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          message: 'Request payload exceeds the maximum allowed size.',
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    next();
  }
}
