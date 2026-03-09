import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

/**
 * HelmetMiddleware
 *
 * Applies a defence-in-depth set of HTTP security headers using the
 * `helmet` package. Each directive is documented inline.
 *
 * Headers applied:
 *  - Content-Security-Policy (CSP) — restricts resource loading origins
 *  - Strict-Transport-Security (HSTS) — enforces HTTPS
 *  - X-Content-Type-Options: nosniff — prevents MIME sniffing
 *  - X-Frame-Options: DENY — prevents clickjacking via iframes
 *  - X-XSS-Protection: 0 — disabled in favour of CSP (modern browsers)
 *  - Referrer-Policy: strict-origin-when-cross-origin
 *  - Cross-Origin-Embedder-Policy, Cross-Origin-Opener-Policy,
 *    Cross-Origin-Resource-Policy
 *  - Permissions-Policy — restricts browser features
 *
 * Note: This is registered as a NestJS middleware so it participates in
 * NestJS's DI and can read config. It wraps the underlying `helmet()`
 * handler. Apply BEFORE routes in app.module.ts or in main.ts.
 */
@Injectable()
export class HelmetMiddleware implements NestMiddleware {
  private readonly handler: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => void;

  constructor(configService: ConfigService) {
    const isProduction =
      configService.get<string>('app.nodeEnv') === 'production';

    this.handler = helmet({
      // Content-Security-Policy for API: restrict to same-origin + trusted
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },

      // HSTS: enforce HTTPS for 1 year inclusive of subdomains
      strictTransportSecurity: isProduction
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,

      // Disable modern MIME-type sniffing
      xContentTypeOptions: true,

      // Block iframes completely (API — no UI served)
      frameguard: { action: 'deny' },

      // Disable legacy XSS filter (CSP is the modern replacement)
      xXssProtection: false,

      // Referrer policy
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

      // Cross-Origin policies
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },

      // Hide the X-Powered-By: Express header
      hidePoweredBy: true,

      // Disable DNS prefetch
      dnsPrefetchControl: { allow: false },

      // IE download prompt (legacy)
      ieNoOpen: true,

      // Permissions-Policy: restrict dangerous browser features
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.handler(req, res, next);
  }
}
