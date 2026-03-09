/**
 * API bootstrap
 *
 * Sentry MUST be initialised before NestFactory.create() so that its
 * async-context tracking is active from the very first import.
 */

// ── Sentry initialisation (must be first) ────────────────────────────────────
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? '',
  enabled:
    process.env['SENTRY_ENABLED'] !== 'false' &&
    process.env['NODE_ENV'] !== 'test',
  environment: process.env['NODE_ENV'] ?? 'development',
  release: process.env['APP_VERSION'] ?? 'unknown',
  tracesSampleRate: Number.parseFloat(
    process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1',
  ),
});
// ─────────────────────────────────────────────────────────────────────────────

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import {
  ObservabilityLoggerService,
  ObservabilityExceptionFilter,
  RequestLoggingInterceptor,
  SentryInterceptor,
} from '@libs/observability';
import {
  RateLimitInterceptor,
  SecurityAuditInterceptor,
  CsrfInterceptor,
} from '@libs/security';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // rawBody: true exposes request.rawBody (Buffer) on all routes.
    // Required by WebhookController to verify Stripe HMAC signatures.
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  // ── Security Headers (Helmet) ────────────────────────────────────────────────
  // Applied as raw Express middleware before any NestJS-level processing.
  // Defence-in-depth: these headers are set even if a WAF/CDN is in front.
  const isProduction =
    configService.get<string>('app.nodeEnv') === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: isProduction ? [] : null,
        },
      },
      strictTransportSecurity: isProduction
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
      xContentTypeOptions: true,
      frameguard: { action: 'deny' },
      xXssProtection: false, // Disabled: CSP is the modern replacement
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: true,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      hidePoweredBy: true,
      dnsPrefetchControl: { allow: false },
      ieNoOpen: true,
    }),
  );

  // ── CORS ────────────────────────────────────────────────────────────────────
  // Uses NestJS's built-in CORS handler (wraps the `cors` npm package).
  // Reads allowed origins from CORS_ALLOWED_ORIGINS env var.
  // Falls back to same-origin in production, open in development.
  const rawOrigins = configService.get<string>('security.cors.allowedOrigins');
  const allowedOrigins: string[] = Array.isArray(rawOrigins)
    ? rawOrigins
    : typeof rawOrigins === 'string' && rawOrigins
      ? rawOrigins
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests without Origin (e.g. server-to-server, curl, Swagger)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 && !isProduction) {
        // Development: allow all origins
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      Logger.warn(`CORS: blocked request from origin: ${origin}`, 'Bootstrap');
      return callback(new Error('Not allowed by CORS'), false);
    },
    credentials:
      configService.get<boolean>('security.cors.credentials') ?? true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-org-id',
      'x-tenant-id',
      'x-csrf-token',
    ],
    maxAge: 86400, // 24h preflight cache
  });

  // ── WebSocket adapter ───────────────────────────────────────────────────────
  // Required to enable socket.io-based WebSocket gateways (e.g. JobsGateway).
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── Global validation pipe ──────────────────────────────────────────────────
  // whitelist: strips unknown properties from DTOs
  // forbidNonWhitelisted: throws 400 if unknown properties are sent
  // transform: auto-converts plain objects to DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── App logger ──────────────────────────────────────────────────────────────
  // Replace NestJS's default ConsoleLogger with the structured observability
  // logger so all internal NestJS messages also go through JSON / pretty format.
  app.useLogger(app.get(ObservabilityLoggerService));

  // ── Global exception filter ─────────────────────────────────────────────────
  // ObservabilityExceptionFilter extends AllExceptionsFilter with:
  //   - Structured JSON logging (tenantId, orgId, actorRole, path, statusCode)
  //   - Sentry capture for 5xx errors with multi-tenant scope
  app.useGlobalFilters(app.get(ObservabilityExceptionFilter));

  // ── Global interceptors ──────────────────────────────────────────────────────
  // Order: request-log → Sentry → rate-limit → CSRF → audit
  // Observability interceptors run first so request metadata is always captured,
  // even if a downstream interceptor short-circuits the chain.
  app.useGlobalInterceptors(
    app.get(RequestLoggingInterceptor),
    app.get(SentryInterceptor),
    app.get(RateLimitInterceptor),
    app.get(CsrfInterceptor),
    app.get(SecurityAuditInterceptor),
  );

  // ── Swagger ──────────────────────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('SaaS Backend API')
    .setDescription(
      '## Overview\n' +
        'REST API for the saas-backend multi-tenant SaaS backend.\n\n' +
        '### Authentication\n' +
        'All protected endpoints require a valid **Auth0 JWT** ' +
        '(`Authorization: Bearer <token>`).\n\n' +
        '### Multi-tenancy\n' +
        'Organization-scoped endpoints are nested under `/organizations/:orgId/`. ' +
        'The caller must be a member of the target organization.\n\n' +
        '### Permissions (RBAC)\n' +
        '| Role | Capabilities |\n' +
        '|------|--------------|\n' +
        '| OWNER | Full control |\n' +
        '| ADMIN | Manage members, read audit |\n' +
        '| MEMBER | Standard access |\n' +
        '| READ_ONLY | Read-only access |\n\n' +
        '### Error format\n' +
        'All errors follow the shape `{ statusCode, timestamp, path, method, message }`.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter Auth0 JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'Authentication endpoints')
    .addTag('Health', 'Health check endpoints')
    .addTag('Organizations', 'Organization management endpoints')
    .addTag('Memberships', 'Organization membership management endpoints')
    .addTag(
      'Feature Flags',
      'Organization feature flag and entitlement endpoints',
    )
    .addTag('Activity Log', 'Activity log query endpoints')
    .addTag('Billing', 'Subscription and billing management endpoints')
    .addTag('Notifications', 'In-app notification management endpoints')
    .addTag('Tasks', 'Task management and job status endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // ── Shutdown hooks ───────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);

  const logger = app.get(ObservabilityLoggerService);
  logger.logCtx(
    `Application running on http://localhost:${port}`,
    { path: `/`, method: 'BOOT' },
    'Bootstrap',
  );
  logger.logCtx(`Swagger:  http://localhost:${port}/docs`, {}, 'Bootstrap');
}

bootstrap();
