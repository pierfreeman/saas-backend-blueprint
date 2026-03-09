import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LegalAuditModule } from '@libs/legal-audit';
import securityConfig from './config/security.config';
import { RateLimitService } from './services/rate-limit.service';
import { BruteForceService } from './services/brute-force.service';
import { CorsMiddleware } from './middleware/cors.middleware';
import { HelmetMiddleware } from './middleware/helmet.middleware';
import { PayloadSanitizationMiddleware } from './middleware/payload-sanitization.middleware';
import { RequestSizeLimitMiddleware } from './middleware/request-size-limit.middleware';
import { RateLimitInterceptor } from './interceptors/rate-limit.interceptor';
import { CsrfInterceptor } from './interceptors/csrf.interceptor';
import { SecurityAuditInterceptor } from './interceptors/security-audit.interceptor';
import { BruteForceGuard } from './guards/brute-force.guard';
import { IpFilterGuard } from './guards/ip-filter.guard';
import { WsJwtGuard } from './guards/ws-jwt.guard';

/**
 * SecurityModule
 *
 * Central security module for the SaaS backend.
 *
 * Provides:
 *  - All security guards (BruteForceGuard, IpFilterGuard, WsJwtGuard)
 *  - All security interceptors (RateLimitInterceptor, CsrfInterceptor,
 *    SecurityAuditInterceptor)
 *  - Security middleware (CorsMiddleware, HelmetMiddleware)
 *  - Redis-backed services (RateLimitService, BruteForceService)
 *
 * Import this module once at the application root:
 * ```typescript
 * @Module({
 *   imports: [SecurityModule],
 * })
 * export class AppModule {}
 * ```
 *
 * Then apply the global interceptors in main.ts:
 * ```typescript
 * const rateLimiter = app.get(RateLimitInterceptor);
 * const auditInterceptor = app.get(SecurityAuditInterceptor);
 * app.useGlobalInterceptors(rateLimiter, auditInterceptor);
 * ```
 */
@Module({
  imports: [
    // Load the security configuration namespace
    ConfigModule.forFeature(securityConfig),
    // LegalAuditModule provides LegalAuditService for compliance logging
    LegalAuditModule,
  ],
  providers: [
    // Services
    RateLimitService,
    BruteForceService,
    // Middleware (injectable for DI, applied in app.module.ts)
    CorsMiddleware,
    HelmetMiddleware,
    RequestSizeLimitMiddleware,
    PayloadSanitizationMiddleware,
    // Interceptors
    RateLimitInterceptor,
    CsrfInterceptor,
    SecurityAuditInterceptor,
    // Guards
    BruteForceGuard,
    IpFilterGuard,
    WsJwtGuard,
  ],
  exports: [
    RateLimitService,
    BruteForceService,
    CorsMiddleware,
    HelmetMiddleware,
    RequestSizeLimitMiddleware,
    PayloadSanitizationMiddleware,
    RateLimitInterceptor,
    CsrfInterceptor,
    SecurityAuditInterceptor,
    BruteForceGuard,
    IpFilterGuard,
    WsJwtGuard,
  ],
})
export class SecurityModule {}
