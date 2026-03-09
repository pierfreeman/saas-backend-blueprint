/**
 * API bootstrap
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AllExceptionsFilter } from '@libs/common';
import {
  RateLimitInterceptor,
  SecurityAuditInterceptor,
  CsrfInterceptor,
} from '@libs/security';
import { AsyncApiDocumentBuilder, AsyncApiModule } from 'nestjs-asyncapi';
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

  // ── Global exception filter ─────────────────────────────────────────────────
  // Returns a consistent { statusCode, timestamp, path, method, message } shape
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── Global security interceptors ────────────────────────────────────────────
  // Applied in order: rate-limit → CSRF → audit
  // These are retrieved from the DI container so they have access to services.
  app.useGlobalInterceptors(
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

  // ── AsyncAPI ──────────────────────────────────────────────────────────────────
  // Generates an AsyncAPI 2.x specification for the `/notifications` Socket.IO
  // namespace and serves an interactive explorer at /asyncapi.
  const asyncApiConfig = new AsyncApiDocumentBuilder()
    .setTitle('SaaS Backend — Notifications WebSocket')
    .setContact(
      'SaaS Backend',
      'https://github.com/pierfreeman/saas-backend-blueprint',
      'noreply@example.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .setDescription(
      '## Overview\n' +
        'AsyncAPI 2.x specification for the real-time `/notifications` Socket.IO namespace.\n\n' +
        '### Authentication\n' +
        'Pass the Auth0 JWT bearer token in one of three ways (checked in order):\n' +
        '1. **Auth option** — `io(url, { auth: { token: "Bearer <jwt>" } })` *(recommended)*\n' +
        '2. **Query string** — `?token=Bearer%20<jwt>`\n' +
        '3. **Authorization header** — `Authorization: Bearer <jwt>` *(non-browser only)*\n\n' +
        '### Rooms\n' +
        'On successful connection the gateway automatically joins each socket to:\n' +
        '- `user:<userId>` — personal room for direct delivery.\n' +
        '- `org:<orgId>` — one room per active organisation membership.\n\n' +
        '### Channel directions\n' +
        '| Direction | Channels |\n' +
        '|-----------|---------|\n' +
        '| Server → Client (subscribe) | `notification:new`, `notification:unread-count`, `notification:list` |\n' +
        '| Client → Server (publish) | `notification:get-all`, `notification:mark-read`, `notification:mark-all-read` |',
    )
    .setVersion('1.0')
    .setDefaultContentType('application/json')
    .addBearerAuth()
    .addServer('notifications-ws', {
      url: 'ws://localhost:3000',
      protocol: 'socket.io',
      description: 'Local development — Socket.IO `/notifications` namespace',
    })
    .build();

  const asyncApiDocument = await AsyncApiModule.createDocument(
    app,
    asyncApiConfig,
  );
  await AsyncApiModule.setup('asyncapi', app, asyncApiDocument);

  // ── Shutdown hooks ───────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}`);
  Logger.log(`📖 Swagger (REST):   http://localhost:${port}/docs`);
  Logger.log(`📡 AsyncAPI (WebSocket): http://localhost:${port}/asyncapi`);
}

bootstrap();
