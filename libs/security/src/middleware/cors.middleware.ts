import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

/**
 * CorsMiddleware
 *
 * Handles Cross-Origin Resource Sharing (CORS) enforcement.
 *
 * Reads allowed origins from `security.cors.allowedOrigins` config,
 * sourced from the `CORS_ALLOWED_ORIGINS` environment variable.
 *
 * Behaviour:
 *  - OPTIONS preflight: responds 204 with CORS headers if origin is allowed.
 *  - Other requests: sets CORS headers if origin is in the allowlist; responds
 *    403 if origin is present but not allowed.
 *  - Requests without an Origin header (e.g. server-to-server) pass through.
 *
 * Note: For production, apply `app.enableCors()` in main.ts instead of (or
 * in addition to) this middleware — see SecurityBootstrap.applyCors().
 * This middleware is kept as a defence-in-depth fallback.
 */
@Injectable()
export class CorsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CorsMiddleware.name);
  private readonly allowedOrigins: string[];
  private readonly credentials: boolean;

  constructor(private readonly configService: ConfigService) {
    this.allowedOrigins =
      this.configService.get<string[]>('security.cors.allowedOrigins') ?? [];
    this.credentials =
      this.configService.get<boolean>('security.cors.credentials') ?? true;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers['origin'];

    if (!origin) {
      // Server-to-server or same-origin — no CORS headers required
      next();
      return;
    }

    const allowed = this.allowedOrigins.includes(origin);

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (this.credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type,Authorization,x-org-id,x-tenant-id,x-csrf-token',
      );
      res.setHeader('Access-Control-Max-Age', '86400'); // 24h preflight cache
    } else {
      this.logger.warn(
        `CORS blocked request from disallowed origin: ${origin}`,
      );
    }

    if (req.method === 'OPTIONS') {
      // Preflight: respond before any guard/interceptor runs
      res.status(allowed ? 204 : 403).end();
      return;
    }

    if (!allowed) {
      res.status(403).json({
        statusCode: 403,
        message: 'CORS: origin not allowed',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    next();
  }
}
